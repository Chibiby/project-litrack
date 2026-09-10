"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  BACKUP_STORE_SETUP_MESSAGE,
  deleteBackup,
  isBackupStoreConfigured,
  latestSafetyBackup,
  parseUploadedBackup,
  readBackup,
  saveBackup,
} from "@/lib/db/backup-store";
import {
  clearOperationalData,
  createSnapshot,
  restoreSnapshot,
  validateSnapshot,
  type SnapshotCounts,
} from "@/lib/db/snapshot";
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
 * These actions are Super-Admin-only and cross every tenant at once, which
 * makes them the one place in the app where `requireUser("SUPER_ADMIN")` is
 * load-bearing on its own rather than backed by a school-scoped query.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Deliberately tight. These are not operations anyone should run in a loop. */
const DESTRUCTIVE_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const BACKUP_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

/**
 * Typed into the confirmation box before a destructive action will run — and
 * `noBackupAck`, which is ticked rather than typed.
 *
 * The Danger-zone actions normally refuse without somewhere to put the safety
 * snapshot. On a project whose Blob store is not wired up yet that would leave
 * an admin unable to clear seed data at all, so `noBackupAck` is the
 * deliberate escape hatch: it travels with one submission, is never
 * remembered, and what it lets through genuinely cannot be undone.
 *
 * One `as const` map rather than separate consts because a "use server" file
 * may not export a bare string.
 */
export const CONFIRM_PHRASES = {
  restore: "RESTORE",
  resetOperational: "CLEAR DATA",
  resetSchoolAccounts: "RESET ACCOUNTS",
  removeTeachers: "REMOVE TEACHERS",
  noBackupAck: "NO BACKUP, NOT REVERSIBLE",
} as const;

const backupPath = z.object({ pathname: z.string().min(1).max(300) });

/** Null when the store is usable; otherwise the refusal to return as-is. */
function storeReady(): { ok: false; error: string } | null {
  return isBackupStoreConfigured() ? null : { ok: false, error: BACKUP_STORE_SETUP_MESSAGE };
}

/**
 * Snapshot the current state into the `safety` slot so the operation about to
 * run can be undone. Returns an error result the caller must propagate — a
 * destructive action whose safety net failed must not proceed.
 */
async function takeSafetySnapshot(operation: string): Promise<ActionResult<{ stamp: string }>> {
  try {
    const snapshot = await createSnapshot();
    const saved = await saveBackup("safety", snapshot);
    return { ok: true, data: { stamp: saved.stamp } };
  } catch (err) {
    console.error(`[database] safety snapshot before ${operation} failed:`, err);
    return {
      ok: false,
      error: `Could not take the safety backup that makes this reversible, so nothing was changed. (${err instanceof Error ? err.message : "Unknown error"})`,
    };
  }
}

/**
 * The safety snapshot a Danger-zone action runs behind, or the refusal to
 * propagate.
 *
 * With a store connected the snapshot is mandatory — if it cannot be written
 * the action does not run. With no store connected there is nowhere to write
 * one, so the action still does not run unless this submission carries the
 * admin's acknowledgement, in which case `stamp` is null and the operation is
 * irreversible.
 */
async function safetyFor(
  operation: string,
  formData: FormData
): Promise<{ ok: true; stamp: string | null } | { ok: false; error: string }> {
  if (isBackupStoreConfigured()) {
    const snapshot = await takeSafetySnapshot(operation);
    if (!snapshot.ok) return snapshot;
    return { ok: true, stamp: snapshot.data?.stamp ?? null };
  }
  if (formData.get("ackNoBackup") !== CONFIRM_PHRASES.noBackupAck) {
    return { ok: false, error: BACKUP_STORE_SETUP_MESSAGE };
  }
  return { ok: true, stamp: null };
}

function totalOf(counts: SnapshotCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Manual "Back up now" — writes into today's daily slot and prunes to 3. */
export async function createBackupNow(): Promise<ActionResult<{ stamp: string; size: number }>> {
  const admin = await requireUser("SUPER_ADMIN");
  const notReady = storeReady();
  if (notReady) return notReady;

  const rate = await checkRateLimit(`db:backup:${admin.id}`, BACKUP_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const snapshot = await createSnapshot();
    const saved = await saveBackup("daily", snapshot);

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_BACKUP_CREATE,
      resource: "Database",
      resourceId: saved.pathname,
      metadata: {
        trigger: "manual",
        kind: "daily",
        totalRows: snapshot.meta.totalRows,
        bytes: saved.size,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { stamp: saved.stamp, size: saved.size } };
  } catch (err) {
    console.error("[database] manual backup failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Backup failed" };
  }
}

/** Restore one of the stored backups over the whole database. */
export async function restoreFromBackup(formData: FormData): Promise<ActionResult<{ counts: SnapshotCounts }>> {
  const admin = await requireUser("SUPER_ADMIN");
  const notReady = storeReady();
  if (notReady) return notReady;

  const parsed = backupPath.safeParse({ pathname: formData.get("pathname") });
  if (!parsed.success) return { ok: false, error: "Invalid backup" };
  if (formData.get("confirm") !== CONFIRM_PHRASES.restore) {
    return { ok: false, error: "Type RESTORE to confirm." };
  }

  const rate = await checkRateLimit(`db:restore:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const snapshot = await readBackup(parsed.data.pathname);
    if (!snapshot) return { ok: false, error: "That backup is no longer in storage." };

    const check = validateSnapshot(snapshot);
    if (!check.ok) return { ok: false, error: check.error };

    // Before, not after: the point of no return is the delete inside
    // restoreSnapshot, and the undo point has to predate it.
    const safety = await takeSafetySnapshot("restore");
    if (!safety.ok) return safety;

    const counts = await restoreSnapshot(check.snapshot);

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESTORE,
      resource: "Database",
      resourceId: parsed.data.pathname,
      metadata: {
        takenAt: check.snapshot.meta.takenAt,
        rowsWritten: totalOf(counts),
        safetyStamp: safety.data?.stamp,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { counts } };
  } catch (err) {
    console.error("[database] restore failed:", err);
    return { ok: false, error: restoreErrorMessage(err) };
  }
}

/** Restore from a file the admin uploaded. */
export async function restoreFromUpload(formData: FormData): Promise<ActionResult<{ counts: SnapshotCounts }>> {
  const admin = await requireUser("SUPER_ADMIN");

  if (formData.get("confirm") !== CONFIRM_PHRASES.restore) {
    return { ok: false, error: "Type RESTORE to confirm." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a backup file first." };
  }

  const rate = await checkRateLimit(`db:restore:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    let parsedJson: unknown;
    try {
      parsedJson = parseUploadedBackup(bytes);
    } catch {
      return { ok: false, error: "That file could not be read as a LITRACK backup (.json or .json.gz)." };
    }

    const check = validateSnapshot(parsedJson);
    if (!check.ok) return { ok: false, error: check.error };

    const safety = await takeSafetySnapshot("upload restore");
    if (!safety.ok) return safety;

    const counts = await restoreSnapshot(check.snapshot);

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESTORE_UPLOAD,
      resource: "Database",
      metadata: {
        filename: file.name,
        takenAt: check.snapshot.meta.takenAt,
        rowsWritten: totalOf(counts),
        safetyStamp: safety.data?.stamp,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { counts } };
  } catch (err) {
    console.error("[database] upload restore failed:", err);
    return { ok: false, error: restoreErrorMessage(err) };
  }
}

/** Put the database back to the safety snapshot taken before the last operation. */
export async function undoLastOperation(): Promise<ActionResult<{ counts: SnapshotCounts }>> {
  const admin = await requireUser("SUPER_ADMIN");
  const notReady = storeReady();
  if (notReady) return notReady;

  const rate = await checkRateLimit(`db:rollback:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const safety = await latestSafetyBackup();
    if (!safety) return { ok: false, error: "There is no operation to undo." };

    const snapshot = await readBackup(safety.pathname);
    if (!snapshot) return { ok: false, error: "The undo point is no longer in storage." };

    const check = validateSnapshot(snapshot);
    if (!check.ok) return { ok: false, error: check.error };

    const counts = await restoreSnapshot(check.snapshot);

    // The undo point is consumed. Leaving it would let a second Undo silently
    // re-apply a state two operations old and look like it did nothing.
    await deleteBackup(safety.pathname);

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_ROLLBACK,
      resource: "Database",
      resourceId: safety.pathname,
      metadata: { restoredTo: check.snapshot.meta.takenAt, rowsWritten: totalOf(counts) },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { counts } };
  } catch (err) {
    console.error("[database] undo failed:", err);
    return { ok: false, error: restoreErrorMessage(err) };
  }
}

/** Empty learners and everything recorded about them; keep schools and accounts. */
export async function resetOperationalData(formData: FormData): Promise<ActionResult<{ removed: SnapshotCounts }>> {
  const admin = await requireUser("SUPER_ADMIN");

  if (formData.get("confirm") !== CONFIRM_PHRASES.resetOperational) {
    return { ok: false, error: `Type ${CONFIRM_PHRASES.resetOperational} to confirm.` };
  }

  const rate = await checkRateLimit(`db:reset:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const safety = await safetyFor("clear operational data", formData);
    if (!safety.ok) return safety;

    const removed = await clearOperationalData();

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESET_OPERATIONAL,
      resource: "Database",
      metadata: {
        rowsRemoved: totalOf(removed),
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { removed } };
  } catch (err) {
    console.error("[database] operational reset failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Reset failed" };
  }
}

/** Every School Head password back to its School ID. */
export async function resetAllSchoolAccounts(formData: FormData): Promise<ActionResult<{ processed: number; failed: number }>> {
  const admin = await requireUser("SUPER_ADMIN");

  if (formData.get("confirm") !== CONFIRM_PHRASES.resetSchoolAccounts) {
    return { ok: false, error: `Type ${CONFIRM_PHRASES.resetSchoolAccounts} to confirm.` };
  }

  const rate = await checkRateLimit(`db:reset-accounts:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const safety = await safetyFor("reset school accounts", formData);
    if (!safety.ok) return safety;

    const result = await resetAllSchoolHeadPasswords();

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_RESET_SCHOOL_ACCOUNTS,
      resource: "User",
      metadata: {
        processed: result.processed,
        failed: result.failed.length,
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    revalidatePath("/admin/school-accounts");
    return { ok: true, data: { processed: result.processed, failed: result.failed.length } };
  } catch (err) {
    console.error("[database] school account reset failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Reset failed" };
  }
}

/** Remove every teacher account (soft delete + Supabase auth deletion). */
export async function removeAllTeachers(formData: FormData): Promise<ActionResult<{ processed: number; failed: number }>> {
  const admin = await requireUser("SUPER_ADMIN");

  if (formData.get("confirm") !== CONFIRM_PHRASES.removeTeachers) {
    return { ok: false, error: `Type ${CONFIRM_PHRASES.removeTeachers} to confirm.` };
  }

  const rate = await checkRateLimit(`db:remove-teachers:${admin.id}`, DESTRUCTIVE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const safety = await safetyFor("remove teacher accounts", formData);
    if (!safety.ok) return safety;

    const result = await removeAllTeacherAccounts();

    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_REMOVE_TEACHER_ACCOUNTS,
      resource: "User",
      metadata: {
        processed: result.processed,
        failed: result.failed.length,
        safetyStamp: safety.stamp,
        reversible: safety.stamp !== null,
      },
    });

    revalidatePath("/admin/database");
    return { ok: true, data: { processed: result.processed, failed: result.failed.length } };
  } catch (err) {
    console.error("[database] teacher removal failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Removal failed" };
  }
}

export async function removeBackup(formData: FormData): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");
  const notReady = storeReady();
  if (notReady) return notReady;

  const parsed = backupPath.safeParse({ pathname: formData.get("pathname") });
  if (!parsed.success) return { ok: false, error: "Invalid backup" };

  try {
    await deleteBackup(parsed.data.pathname);
    await writeAudit({
      userId: admin.id,
      action: AUDIT_ACTIONS.DB_BACKUP_DELETE,
      resource: "Database",
      resourceId: parsed.data.pathname,
    });
    revalidatePath("/admin/database");
    return { ok: true };
  } catch (err) {
    console.error("[database] backup delete failed:", err);
    return { ok: false, error: "Could not delete that backup." };
  }
}

/**
 * A failed restore has already deleted rows inside its transaction, so Postgres
 * has rolled the whole thing back — but an admin staring at an error needs to
 * be told that explicitly, not left guessing whether the database is half
 * empty.
 */
function restoreErrorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : "Unknown error";
  return `Restore failed and was rolled back — the database is unchanged. (${detail})`;
}
