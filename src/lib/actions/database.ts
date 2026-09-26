"use server";

import { revalidatePath } from "next/cache";
import { revalidateAllCachedData } from "@/lib/cache/revalidate";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { CONFIRM_PHRASES } from "@/lib/constants/confirm-phrases";
import { action } from "@/lib/errors/action";
import { AppError, tooManyAttempts } from "@/lib/errors/app-error";
import { classifyError } from "@/lib/errors/classify";
import {
  BACKUP_STORE_SETUP_MESSAGE,
  deleteBackup,
  isBackupStoreConfigured,
  latestSafetyBackup,
  openBackupStream,
  pruneKind,
  parseBackupPath,
} from "@/lib/db/backup-store";
import {
  backUpDatabase,
  clearOperationalData,
  inspectBackup,
  restoreBackup,
  type BackupOpener,
  type InspectedBackup,
  type SnapshotCounts,
} from "@/lib/db/snapshot";
import { SnapshotFormatError } from "@/lib/db/snapshot-format";
import { removeAllTeacherAccounts, resetAllSchoolHeadPasswords } from "@/lib/db/account-reset";

/**
 * Super Admin database console.
 *
 * Every destructive action in this file takes a safety snapshot BEFORE it runs
 * and stores it under the `safety` slot. That snapshot is what "Undo last
 * operation" restores, and it is the reason a reset here is survivable at all.
 * If the safety snapshot cannot be written, the destructive action does not
 * run — refusing is always better than proceeding with no way back. The one
 * exception is a project with no backup store connected at all, where the
 * three Danger-zone actions accept an explicit per-run acknowledgement
 * (`CONFIRM_PHRASES.noBackupAck`) instead of a snapshot.
 *
 * These actions are Super-Admin-only and, unscoped, cross every tenant at
 * once — which makes them the one place in the app where
 * `requireUser("SUPER_ADMIN")` is load-bearing on its own rather than backed by
 * a school-scoped query. The three Danger-zone actions also accept a
 * `schoolId` that narrows them to one school; see `resolveTarget`.
 *
 * Every export is wrapped once by `action()`: refusals are thrown as
 * `AppError`s and anything unexpected is classified, recorded and answered
 * with a safe message. The raw error text these actions used to return (a
 * Prisma message could name tables and values) now reaches only the admin
 * error log.
 */

/** Deliberately tight. These are not operations anyone should run in a loop. */
const DESTRUCTIVE_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const BACKUP_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

/**
 * Completes "Couldn't {verb}: …" when a restore fails in the database. A failed
 * restore has already deleted rows inside its transaction, so Postgres has
 * rolled the whole thing back — but an admin staring at an error needs to be
 * told that explicitly, not left guessing whether the database is half empty.
 */
const RESTORE_VERB = "restore the backup (it was rolled back, so the database is unchanged)";

/*
 * The confirmation phrases live in `@/lib/constants/confirm-phrases`, a plain
 * module. They cannot be defined here: a "use server" file may export nothing
 * but async functions, and an exported `as const` map trips that rule at
 * runtime — on whatever unrelated page happens to pull this module into its
 * action chunk. See that file's header for the full story.
 */

/**
 * The store would reject a path outside the backup layout too, but as a plain
 * throw that classifies as a system error and emails an alert. Checking here
 * makes a tampered path the refusal it is.
 */
const backupPath = z.object({
  pathname: z
    .string()
    .min(1)
    .max(300)
    .refine((p) => parseBackupPath(p) !== null),
});

/**
 * A refusal the admin can act on, worded exactly as the console has always
 * shown it. `VALIDATION_FAILED` is the catalog's carrier for a caller-written
 * sentence, and its `user` severity keeps a mistyped confirmation phrase out of
 * the error log and the alert email.
 */
function refuse(message: string): AppError {
  return new AppError("VALIDATION_FAILED", { params: { message } });
}

/** Throws when there is no store: backing up, restoring and undoing all need one. */
function requireStore(): void {
  if (!isBackupStoreConfigured()) throw refuse(BACKUP_STORE_SETUP_MESSAGE);
}

async function enforceRate(key: string, limits: { limit: number; windowMs: number }): Promise<void> {
  const rate = await checkRateLimit(key, limits);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");
}

/**
 * Snapshot the current state into the `safety` slot so the operation about to
 * run can be undone. Throws when it cannot — a destructive action whose safety
 * net failed must not proceed, and the throw is what stops it.
 */
async function takeSafetySnapshot(
  operation: string,
  options: { prune?: boolean } = {}
): Promise<{ stamp: string; pathname: string }> {
  try {
    const { saved } = await backUpDatabase("safety", { prune: options.prune });
    return { stamp: saved.stamp, pathname: saved.pathname };
  } catch (err) {
    const classified = classifyError(err, {
      verb: "take the safety backup that makes this reversible, so nothing was changed",
    });
    // Database failures already read correctly with the verb above. Anything
    // else here is the backup store or the snapshot itself.
    if (classified.code !== "INTERNAL_ERROR") throw classified;
    throw new AppError("SERVICE_UNAVAILABLE", {
      params: { service: "Backup storage" },
      cause: err,
      detail: `Safety snapshot before ${operation} failed; nothing was changed. ${classified.detail ?? ""}`.trim(),
      context: { service: "blob", operation },
    });
  }
}

/**
 * The safety snapshot a Danger-zone action runs behind.
 *
 * With a store connected the snapshot is mandatory — if it cannot be written
 * the action does not run. With no store connected there is nowhere to write
 * one, so the action still does not run unless this submission carries the
 * admin's acknowledgement, in which case `stamp` is null and the operation is
 * irreversible.
 */
async function safetyFor(operation: string, formData: FormData): Promise<{ stamp: string | null }> {
  if (isBackupStoreConfigured()) return takeSafetySnapshot(operation);
  if (formData.get("ackNoBackup") !== CONFIRM_PHRASES.noBackupAck) {
    throw refuse(BACKUP_STORE_SETUP_MESSAGE);
  }
  return { stamp: null };
}

/**
 * Which school a Danger-zone action applies to.
 *
 * An empty `schoolId` means every school, which is what these three have always
 * done. A named school is looked up here rather than trusted from the client:
 * the picker in the console is a convenience, and a stale or edited value must
 * not be able to point an irreversible operation at the wrong tenant — or, by
 * being silently dropped, at all of them.
 *
 * The safety snapshot stays whole-database either way. It is the undo point,
 * and restoring more than was touched is correct; restoring less is not.
 */
async function resolveTarget(formData: FormData): Promise<{ schoolId: string | null; name: string | null }> {
  const raw = formData.get("schoolId");
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { schoolId: null, name: null };

  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw refuse("That school could not be identified.");

  const school = await prisma.school.findFirst({
    where: { id: parsed.data, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!school) throw refuse("That school no longer exists.");

  return { schoolId: school.id, name: school.name };
}

/** Audit fields shared by the three Danger-zone actions. */
function scopeMetadata(target: { schoolId: string | null; name: string | null }) {
  return {
    scope: target.schoolId ? ("school" as const) : ("all-schools" as const),
    schoolName: target.name ?? undefined,
  };
}

function totalOf(counts: SnapshotCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * Bring the `safety` slot back to its one file once a restore has committed
 * and no longer needs the file it read. Best-effort: the restore succeeded,
 * and an extra undo point left behind is pruned by the next safety snapshot.
 */
async function pruneSafetyAfterRestore(): Promise<void> {
  try {
    await pruneKind("safety");
  } catch (err) {
    console.error("[database] safety prune after restore failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Undo the safety snapshot a restore just took, because the restore itself
 * never committed. Best-effort: `runRestore` already has the real error to
 * rethrow, and a cleanup failure here must not replace or mask it — it would
 * otherwise leave a fresh, redundant undo point (identical to the state the
 * database was already in) shadowing the real previous undo point.
 */
async function discardSafetyAfterFailedRestore(pathname: string): Promise<void> {
  try {
    await deleteBackup(pathname);
  } catch (err) {
    console.error(
      "[database] safety snapshot cleanup after failed restore failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * The undo point a completed restore consumed. Best-effort, same reasoning as
 * `pruneSafetyAfterRestore`: the restore already committed, so a delete
 * failure here must never surface as "the restore failed" — the caller's
 * audit row and cache revalidation still have to run.
 */
async function deleteConsumedUndoPoint(pathname: string): Promise<void> {
  try {
    await deleteBackup(pathname);
  } catch (err) {
    console.error(
      "[database] undo point delete after restore failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** A stored backup, re-opened on each call. */
function storedBackup(pathname: string): BackupOpener {
  return async () => (await openBackupStream(pathname))?.stream ?? null;
}

/**
 * Validate a backup end to end before anything destructive: refuses with the
 * file's own problem, or with `missing` when it is not in storage.
 */
async function requireRestorable(
  open: BackupOpener,
  missing: string
): Promise<Extract<InspectedBackup, { ok: true }>> {
  const inspected = await inspectBackup(open);
  if (!inspected) throw refuse(missing);
  if (!inspected.ok) throw refuse(inspected.error);
  return inspected;
}

/**
 * Run the restore itself. A file that passed inspection but fails the same
 * checks mid-stream (it changed in storage, or was cut short in transit) is
 * still the admin's to know about, and the transaction has rolled back.
 */
async function runRestore(
  inspected: Extract<InspectedBackup, { ok: true }>,
  open: BackupOpener
): Promise<SnapshotCounts> {
  try {
    return await restoreBackup(inspected, open);
  } catch (err) {
    if (err instanceof SnapshotFormatError) {
      throw refuse(`${err.message} The restore was rolled back; the database is unchanged.`);
    }
    throw err;
  }
}

/** Manual "Back up now" — writes into today's daily slot and prunes to 3. */
export const createBackupNow = action(
  "createBackupNow",
  async () => {
    const admin = await requireUser("SUPER_ADMIN");
    requireStore();
    await enforceRate(`db:backup:${admin.id}`, BACKUP_RATE);

    const { saved, totalRows } = await backUpDatabase("daily");

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_BACKUP_CREATE,
      resource: "Database",
      resourceId: saved.pathname,
      metadata: {
        trigger: "manual",
        kind: "daily",
        totalRows,
        bytes: saved.size,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true as const, data: { stamp: saved.stamp, size: saved.size } };
  },
  { verb: "back up the database" }
);

/** Restore one of the stored backups over the whole database. */
export const restoreFromBackup = action(
  "restoreFromBackup",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");
    requireStore();

    const parsed = backupPath.safeParse({ pathname: formData.get("pathname") });
    if (!parsed.success) throw refuse("Invalid backup");
    if (formData.get("confirm") !== CONFIRM_PHRASES.restore) {
      throw refuse(`Type ${CONFIRM_PHRASES.restore} to confirm.`);
    }

    await enforceRate(`db:restore:${admin.id}`, DESTRUCTIVE_RATE);

    const open = storedBackup(parsed.data.pathname);
    const inspected = await requireRestorable(open, "That backup is no longer in storage.");

    // Before, not after: the point of no return is the delete inside the
    // restore, and the undo point has to predate it. Unpruned: the file being
    // restored may itself be the current undo point, and `safety` keeps one
    // — pruning now would delete the file the restore is about to read.
    const safety = await takeSafetySnapshot("restore", { prune: false });

    let counts: SnapshotCounts;
    try {
      counts = await runRestore(inspected, open);
    } catch (err) {
      // The restore never committed, so the fresh snapshot just taken is
      // identical to the state the database is still in — leaving it behind
      // would let it outrank the real previous undo point.
      await discardSafetyAfterFailedRestore(safety.pathname);
      throw err;
    }
    await pruneSafetyAfterRestore();

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESTORE,
      resource: "Database",
      resourceId: parsed.data.pathname,
      metadata: {
        takenAt: inspected.takenAt,
        format: inspected.format,
        rowsWritten: totalOf(counts),
        safetyStamp: safety.stamp,
      },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    return { ok: true as const, data: { counts } };
  },
  { verb: RESTORE_VERB }
);

/** Restore from a file the admin uploaded. */
export const restoreFromUpload = action(
  "restoreFromUpload",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");

    if (formData.get("confirm") !== CONFIRM_PHRASES.restore) {
      throw refuse(`Type ${CONFIRM_PHRASES.restore} to confirm.`);
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw refuse("Choose a backup file first.");
    }

    await enforceRate(`db:restore:${admin.id}`, DESTRUCTIVE_RATE);

    // `File.stream()` re-reads the upload each call, which is what the
    // validate-then-restore double pass needs.
    const open: BackupOpener = async () => file.stream();

    let inspected: Extract<InspectedBackup, { ok: true }>;
    try {
      inspected = await requireRestorable(open, "Choose a backup file first.");
    } catch (err) {
      if (err instanceof AppError) throw err;
      // The bytes are local, so a failure to decode them (a bad gzip stream,
      // invalid UTF-8) is the file, not the network.
      throw refuse("That file could not be read as a LITRACK backup (.ndjson.gz, .json.gz or .json).");
    }

    // Unpruned until the restore commits, the same as a stored restore: the
    // previous undo point should outlive a restore that fails.
    const safety = await takeSafetySnapshot("upload restore", { prune: false });

    let counts: SnapshotCounts;
    try {
      counts = await runRestore(inspected, open);
    } catch (err) {
      // Same reasoning as restoreFromBackup: the restore never committed, so
      // this snapshot is redundant and must not shadow the real undo point.
      await discardSafetyAfterFailedRestore(safety.pathname);
      throw err;
    }
    await pruneSafetyAfterRestore();

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESTORE_UPLOAD,
      resource: "Database",
      metadata: {
        filename: file.name,
        takenAt: inspected.takenAt,
        format: inspected.format,
        rowsWritten: totalOf(counts),
        safetyStamp: safety.stamp,
      },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    return { ok: true as const, data: { counts } };
  },
  { verb: RESTORE_VERB }
);

/** Put the database back to the safety snapshot taken before the last operation. */
export const undoLastOperation = action(
  "undoLastOperation",
  async () => {
    const admin = await requireUser("SUPER_ADMIN");
    requireStore();
    await enforceRate(`db:rollback:${admin.id}`, DESTRUCTIVE_RATE);

    const safety = await latestSafetyBackup();
    if (!safety) throw refuse("There is no operation to undo.");

    const open = storedBackup(safety.pathname);
    const inspected = await requireRestorable(open, "The undo point is no longer in storage.");

    const counts = await runRestore(inspected, open);

    // The undo point is consumed. Leaving it would let a second Undo silently
    // re-apply a state two operations old and look like it did nothing.
    // Best-effort: the restore already committed, so a delete failure here
    // must not surface as the RESTORE_VERB failure — the audit row and cache
    // revalidation below still have to run, and a retry must not re-apply.
    await deleteConsumedUndoPoint(safety.pathname);

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_ROLLBACK,
      resource: "Database",
      resourceId: safety.pathname,
      metadata: { restoredTo: inspected.takenAt, format: inspected.format, rowsWritten: totalOf(counts) },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    return { ok: true as const, data: { counts } };
  },
  { verb: RESTORE_VERB }
);

/** Empty learners and everything recorded about them; keep schools and accounts. */
export const resetOperationalData = action(
  "resetOperationalData",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");

    if (formData.get("confirm") !== CONFIRM_PHRASES.resetOperational) {
      throw refuse(`Type ${CONFIRM_PHRASES.resetOperational} to confirm.`);
    }

    await enforceRate(`db:reset:${admin.id}`, DESTRUCTIVE_RATE);

    const target = await resolveTarget(formData);
    const safety = await safetyFor("clear operational data", formData);

    const removed = await clearOperationalData(target.schoolId);

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId ?? undefined,
      action: AUDIT_ACTIONS.DB_RESET_OPERATIONAL,
      resource: "Database",
      resourceId: target.schoolId ?? undefined,
      metadata: {
        ...scopeMetadata(target),
        rowsRemoved: totalOf(removed),
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    return { ok: true as const, data: { removed } };
  },
  { verb: "clear the data" }
);

/** Every School Head password back to its School ID. */
export const resetAllSchoolAccounts = action(
  "resetAllSchoolAccounts",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");

    if (formData.get("confirm") !== CONFIRM_PHRASES.resetSchoolAccounts) {
      throw refuse(`Type ${CONFIRM_PHRASES.resetSchoolAccounts} to confirm.`);
    }

    await enforceRate(`db:reset-accounts:${admin.id}`, DESTRUCTIVE_RATE);

    const target = await resolveTarget(formData);
    const safety = await safetyFor("reset school accounts", formData);

    const result = await resetAllSchoolHeadPasswords(target.schoolId);

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId ?? undefined,
      action: AUDIT_ACTIONS.DB_RESET_SCHOOL_ACCOUNTS,
      resource: "User",
      metadata: {
        ...scopeMetadata(target),
        processed: result.processed,
        failed: result.failed.length,
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    revalidatePath("/admin/accounts");
    return { ok: true as const, data: { processed: result.processed, failed: result.failed.length } };
  },
  { verb: "reset the school accounts" }
);

/** Remove every teacher account (soft delete + Supabase auth deletion). */
export const removeAllTeachers = action(
  "removeAllTeachers",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");

    if (formData.get("confirm") !== CONFIRM_PHRASES.removeTeachers) {
      throw refuse(`Type ${CONFIRM_PHRASES.removeTeachers} to confirm.`);
    }

    await enforceRate(`db:remove-teachers:${admin.id}`, DESTRUCTIVE_RATE);

    const target = await resolveTarget(formData);
    const safety = await safetyFor("remove teacher accounts", formData);

    const result = await removeAllTeacherAccounts(target.schoolId);

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId ?? undefined,
      action: AUDIT_ACTIONS.DB_REMOVE_TEACHER_ACCOUNTS,
      resource: "User",
      metadata: {
        ...scopeMetadata(target),
        processed: result.processed,
        failed: result.failed.length,
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    revalidateAllCachedData();
    return { ok: true as const, data: { processed: result.processed, failed: result.failed.length } };
  },
  { verb: "remove the teacher accounts" }
);

export const removeBackup = action(
  "removeBackup",
  async (formData: FormData) => {
    const admin = await requireUser("SUPER_ADMIN");
    requireStore();

    const parsed = backupPath.safeParse({ pathname: formData.get("pathname") });
    if (!parsed.success) throw refuse("Invalid backup");

    await deleteBackup(parsed.data.pathname);
    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_BACKUP_DELETE,
      resource: "Database",
      resourceId: parsed.data.pathname,
    });
    revalidatePath("/admin/database");
    return { ok: true as const };
  },
  { verb: "delete that backup" }
);
