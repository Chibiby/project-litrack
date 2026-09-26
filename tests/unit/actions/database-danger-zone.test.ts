import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Danger-zone half of the Super Admin database console.
 *
 * The property under test is the one that decides whether an irreversible
 * operation runs at all:
 *
 * - **With a backup store connected, the safety snapshot is mandatory.** If it
 *   cannot be written the action refuses, and no acknowledgement from the
 *   client can talk it into proceeding.
 * - **With no store connected there is nowhere to put a snapshot**, so the
 *   action refuses too — unless that submission carries the `noBackupAck`
 *   token, the per-run acknowledgement the console asks for by checkbox. That
 *   is the escape hatch for a project whose Blob store is not wired up yet.
 * - **The audit row says which of those two happened**, because "was this
 *   undoable?" is the first question anyone asks afterwards.
 *
 * The second property is the school scope: an action may be pointed at one
 * school, and the id it is pointed at is re-read from the database rather than
 * trusted, so a stale picker cannot aim an irreversible operation at the wrong
 * tenant or, by being dropped, at every tenant.
 *
 * Mocked at the module boundary like the other action tests here: the blob
 * store, the snapshot writer and Supabase are all out of scope.
 */

const isBackupStoreConfigured = vi.fn();
const pruneKind = vi.fn();
vi.mock("@/lib/db/backup-store", () => ({
  BACKUP_STORE_SETUP_MESSAGE: "Backup storage is not connected.",
  isBackupStoreConfigured: () => isBackupStoreConfigured(),
  parseBackupPath: () => ({ kind: "daily", stamp: "x" }),
  deleteBackup: vi.fn(),
  latestSafetyBackup: vi.fn(),
  openBackupStream: vi.fn(),
  pruneKind: (...a: unknown[]) => pruneKind(...a),
}));

// One call now takes and stores the snapshot; it replaced createSnapshot +
// saveBackup when backups started streaming.
const backUpDatabase = vi.fn();
const clearOperationalData = vi.fn();
vi.mock("@/lib/db/snapshot", () => ({
  backUpDatabase: (...a: unknown[]) => backUpDatabase(...a),
  clearOperationalData: (...a: unknown[]) => clearOperationalData(...a),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

const removeAllTeacherAccounts = vi.fn();
const resetAllSchoolHeadPasswords = vi.fn();
vi.mock("@/lib/db/account-reset", () => ({
  removeAllTeacherAccounts: (...a: unknown[]) => removeAllTeacherAccounts(...a),
  resetAllSchoolHeadPasswords: (...a: unknown[]) => resetAllSchoolHeadPasswords(...a),
}));

const schoolFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findFirst() {
        return schoolFindFirst;
      },
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
  AUDIT_ACTIONS: {
    DB_BACKUP_CREATE: "DB_BACKUP_CREATE",
    DB_BACKUP_DELETE: "DB_BACKUP_DELETE",
    DB_RESTORE: "DB_RESTORE",
    DB_RESTORE_UPLOAD: "DB_RESTORE_UPLOAD",
    DB_ROLLBACK: "DB_ROLLBACK",
    DB_RESET_OPERATIONAL: "DB_RESET_OPERATIONAL",
    DB_RESET_SCHOOL_ACCOUNTS: "DB_RESET_SCHOOL_ACCOUNTS",
    DB_REMOVE_TEACHER_ACCOUNTS: "DB_REMOVE_TEACHER_ACCOUNTS",
  },
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const revalidateAllCachedData = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateAllCachedData: (...a: unknown[]) => revalidateAllCachedData(...a),
}));

// The action() wrapper records non-user failures; the recorder itself is
// covered in tests/unit/errors.
const reportError = vi.fn((..._a: unknown[]) => "E-TESTREF8");
vi.mock("@/lib/errors/report", () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

// Imported after the mock factories above are registered.
const {
  removeAllTeachers,
  resetAllSchoolAccounts,
  resetOperationalData,
  restoreFromBackup,
  restoreFromUpload,
  undoLastOperation,
  createBackupNow,
} = await import("@/lib/actions/database");
const snapshotMock = await import("@/lib/db/snapshot");
const backupStoreMock = await import("@/lib/db/backup-store");
// Not from the action module: a "use server" file may export only async
// functions, so the phrases live in a plain module both sides import.
const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };
const SCHOOL = { id: "6b1d0c4a-8e2f-4a7b-9c3d-1e5f7a9b0c2d", name: "Camarin Elementary School" };

function form(confirm: string, ack?: string, schoolId?: string): FormData {
  const fd = new FormData();
  fd.set("confirm", confirm);
  if (ack !== undefined) fd.set("ackNoBackup", ack);
  if (schoolId !== undefined) fd.set("schoolId", schoolId);
  return fd;
}

/** The last audit row written, whatever action it was for. */
function lastAudit(): Record<string, unknown> {
  return writeAudit.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  checkRateLimit.mockResolvedValue({ ok: true });
  writeAudit.mockResolvedValue(undefined);
  backUpDatabase.mockResolvedValue({
    saved: { stamp: "2026-09-10T00:00:00.000Z", pathname: "p", size: 1 },
    takenAt: "2026-09-10T00:00:00.000Z",
    totalRows: 0,
  });
  clearOperationalData.mockResolvedValue({ Learner: 12 });
  vi.mocked(backupStoreMock.deleteBackup).mockResolvedValue(undefined);
  schoolFindFirst.mockResolvedValue(SCHOOL);
  resetAllSchoolHeadPasswords.mockResolvedValue({ processed: 3, failed: [] });
  removeAllTeacherAccounts.mockResolvedValue({ processed: 8, failed: [] });
});

describe("Danger zone with no backup store connected", () => {
  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(false);
  });

  it("refuses to clear operational data when the run is not acknowledged", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational));

    expect(res).toMatchObject({ ok: false, error: "Backup storage is not connected." });
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("refuses when the acknowledgement is present but not the exact phrase", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, "yes"));

    expect(res.ok).toBe(false);
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("still requires the typed confirmation phrase alongside the acknowledgement", async () => {
    const res = await resetOperationalData(form("clear data", CONFIRM_PHRASES.noBackupAck));

    expect(res).toMatchObject({ ok: false, error: `Type ${CONFIRM_PHRASES.resetOperational} to confirm.` });
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("clears operational data once acknowledged, without attempting a snapshot", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, CONFIRM_PHRASES.noBackupAck));

    expect(res).toEqual({ ok: true, data: { removed: { Learner: 12 } } });
    expect(clearOperationalData).toHaveBeenCalledTimes(1);
    expect(backUpDatabase).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({
      action: "DB_RESET_OPERATIONAL",
      metadata: { rowsRemoved: 12, safetyStamp: null, reversible: false },
    });
  });

  it("resets school accounts once acknowledged", async () => {
    const res = await resetAllSchoolAccounts(form(CONFIRM_PHRASES.resetSchoolAccounts, CONFIRM_PHRASES.noBackupAck));

    expect(res).toEqual({ ok: true, data: { processed: 3, failed: 0 } });
    expect(resetAllSchoolHeadPasswords).toHaveBeenCalledTimes(1);
    expect(lastAudit()).toMatchObject({ metadata: { reversible: false } });
  });

  it("refuses to reset school accounts without the acknowledgement", async () => {
    const res = await resetAllSchoolAccounts(form(CONFIRM_PHRASES.resetSchoolAccounts));

    expect(res.ok).toBe(false);
    expect(resetAllSchoolHeadPasswords).not.toHaveBeenCalled();
  });

  it("removes teachers once acknowledged", async () => {
    const res = await removeAllTeachers(form(CONFIRM_PHRASES.removeTeachers, CONFIRM_PHRASES.noBackupAck));

    expect(res).toEqual({ ok: true, data: { processed: 8, failed: 0 } });
    expect(removeAllTeacherAccounts).toHaveBeenCalledTimes(1);
    expect(lastAudit()).toMatchObject({ metadata: { reversible: false } });
  });

  it("refuses to remove teachers without the acknowledgement", async () => {
    const res = await removeAllTeachers(form(CONFIRM_PHRASES.removeTeachers));

    expect(res.ok).toBe(false);
    expect(removeAllTeacherAccounts).not.toHaveBeenCalled();
  });
});

describe("Danger zone with a backup store connected", () => {
  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(true);
  });

  it("takes the safety snapshot and records the run as reversible", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational));

    expect(res.ok).toBe(true);
    // The Danger zone prunes as it writes (no prune: false); only restore defers.
    expect(backUpDatabase.mock.calls[0][0]).toBe("safety");
    expect(backUpDatabase.mock.calls[0][1]?.prune).not.toBe(false);
    expect(lastAudit()).toMatchObject({
      metadata: { safetyStamp: "2026-09-10T00:00:00.000Z", reversible: true },
    });
  });

  it("refuses when the snapshot fails, acknowledgement or not", async () => {
    backUpDatabase.mockRejectedValue(new Error("blob write failed"));

    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, CONFIRM_PHRASES.noBackupAck));

    expect(res.ok).toBe(false);
    expect(clearOperationalData).not.toHaveBeenCalled();
  });
});

describe("scoping a Danger-zone action to one school", () => {
  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(true);
  });

  it("clears only the named school, looked up rather than trusted", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, undefined, SCHOOL.id));

    expect(res.ok).toBe(true);
    expect(schoolFindFirst).toHaveBeenCalledWith({
      where: { id: SCHOOL.id, deletedAt: null },
      select: { id: true, name: true },
    });
    expect(clearOperationalData).toHaveBeenCalledWith(SCHOOL.id);
    expect(lastAudit()).toMatchObject({
      schoolId: SCHOOL.id,
      resourceId: SCHOOL.id,
      metadata: { scope: "school", schoolName: SCHOOL.name },
    });
  });

  it("clears every school when no school is named", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational));

    expect(res.ok).toBe(true);
    expect(schoolFindFirst).not.toHaveBeenCalled();
    expect(clearOperationalData).toHaveBeenCalledWith(null);
    expect(lastAudit()).toMatchObject({ metadata: { scope: "all-schools" } });
  });

  it("treats an empty school field as every school rather than as an error", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, undefined, "   "));

    expect(res.ok).toBe(true);
    expect(clearOperationalData).toHaveBeenCalledWith(null);
  });

  it("refuses a school that is archived or gone, and changes nothing", async () => {
    schoolFindFirst.mockResolvedValue(null);

    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, undefined, SCHOOL.id));

    expect(res).toMatchObject({ ok: false, error: "That school no longer exists." });
    expect(clearOperationalData).not.toHaveBeenCalled();
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("refuses an id that is not an id, without touching the database", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, undefined, "../../etc"));

    expect(res.ok).toBe(false);
    expect(schoolFindFirst).not.toHaveBeenCalled();
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("resolves the school before taking the safety snapshot", async () => {
    schoolFindFirst.mockResolvedValue(null);

    await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, undefined, SCHOOL.id));

    // A refused target must not leave a safety point behind that "Undo last
    // operation" would then offer for an operation that never happened.
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("scopes the school-account reset", async () => {
    const res = await resetAllSchoolAccounts(
      form(CONFIRM_PHRASES.resetSchoolAccounts, undefined, SCHOOL.id)
    );

    expect(res.ok).toBe(true);
    expect(resetAllSchoolHeadPasswords).toHaveBeenCalledWith(SCHOOL.id);
    expect(lastAudit()).toMatchObject({ schoolId: SCHOOL.id, metadata: { scope: "school" } });
  });

  it("scopes teacher removal", async () => {
    const res = await removeAllTeachers(form(CONFIRM_PHRASES.removeTeachers, undefined, SCHOOL.id));

    expect(res.ok).toBe(true);
    expect(removeAllTeacherAccounts).toHaveBeenCalledWith(SCHOOL.id);
    expect(lastAudit()).toMatchObject({ schoolId: SCHOOL.id, metadata: { scope: "school" } });
  });

  it("still refuses a scoped run with no backup store and no acknowledgement", async () => {
    isBackupStoreConfigured.mockReturnValue(false);

    const res = await removeAllTeachers(form(CONFIRM_PHRASES.removeTeachers, undefined, SCHOOL.id));

    expect(res.ok).toBe(false);
    expect(removeAllTeacherAccounts).not.toHaveBeenCalled();
  });
});

describe("through the action() wrapper", () => {
  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(true);
  });

  it("answers a mistyped phrase as a user refusal, not a recorded error", async () => {
    const res = await resetOperationalData(form("clear"));

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("never shows the raw error when the safety snapshot fails", async () => {
    backUpDatabase.mockRejectedValue(new Error('relation "Learner" does not exist'));

    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/relation|Learner/);
      expect(res).toMatchObject({ code: "SERVICE_UNAVAILABLE", ref: "E-TESTREF8" });
    }
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("turns a rate limit into RATE_LIMITED", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });

    const res = await createBackupNow();

    expect(res).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("checks the restore phrase before reading the backup", async () => {
    const fd = new FormData();
    fd.set("pathname", "litrack/backups/daily/2026-09-26.ndjson.gz");
    fd.set("confirm", "restore");

    const res = await restoreFromBackup(fd);

    expect(res).toMatchObject({ ok: false, error: `Type ${CONFIRM_PHRASES.restore} to confirm.` });
    expect(snapshotMock.inspectBackup).not.toHaveBeenCalled();
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("checks the Super Admin role first", async () => {
    await createBackupNow();
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });
});

describe("restoring the current undo point from the backup list", () => {
  const SAFETY = "litrack/backups/safety/2026-09-25T10-00-00-000Z.ndjson.gz";
  const order: string[] = [];

  function restoreForm(): FormData {
    const fd = new FormData();
    fd.set("pathname", SAFETY);
    fd.set("confirm", CONFIRM_PHRASES.restore);
    return fd;
  }

  beforeEach(() => {
    order.length = 0;
    isBackupStoreConfigured.mockReturnValue(true);
    vi.mocked(snapshotMock.inspectBackup).mockResolvedValue({ ok: true, format: 2, takenAt: "t", totalRows: 1 });
    backUpDatabase.mockImplementation(async (kind: string, options?: { prune?: boolean }) => {
      order.push(`snapshot:${kind}:prune=${String(options?.prune)}`);
      return { saved: { stamp: "s", pathname: "p", size: 1 }, takenAt: "t", totalRows: 0 };
    });
    vi.mocked(snapshotMock.restoreBackup).mockImplementation(async () => {
      order.push("restore");
      return { School: 1 };
    });
    pruneKind.mockImplementation(async () => {
      order.push("prune");
      return [];
    });
  });

  it("keeps the target until the restore has read it, then prunes", async () => {
    const res = await restoreFromBackup(restoreForm());

    expect(res.ok).toBe(true);
    // The safety snapshot must not prune: `safety` keeps one file, and the
    // file being restored is that one.
    expect(order).toEqual(["snapshot:safety:prune=false", "restore", "prune"]);
    expect(pruneKind).toHaveBeenCalledWith("safety");
  });

  it("does not prune at all when the restore fails, so the chosen undo point survives", async () => {
    vi.mocked(snapshotMock.restoreBackup).mockRejectedValue(new Error("FK violation"));

    const res = await restoreFromBackup(restoreForm());

    expect(res.ok).toBe(false);
    expect(pruneKind).not.toHaveBeenCalled();
  });

  it("refuses a stored backup that turns out corrupt, as the file's problem", async () => {
    vi.mocked(snapshotMock.inspectBackup).mockResolvedValue({
      ok: false,
      error: "That backup could not be decompressed or decoded; the file is damaged.",
    });

    const res = await restoreFromBackup(restoreForm());

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(reportError).not.toHaveBeenCalled();
    expect(backUpDatabase).not.toHaveBeenCalled();
  });

  it("discards the just-taken safety snapshot when the restore itself fails, without changing the reported failure", async () => {
    vi.mocked(snapshotMock.restoreBackup).mockRejectedValue(new Error("FK violation"));

    const res = await restoreFromBackup(restoreForm());

    // The one thing the fix changes: deleteBackup is now called with the
    // pathname of the safety snapshot the failed restore just took (from
    // this describe block's shared backUpDatabase mock, which returns "p").
    expect(backupStoreMock.deleteBackup).toHaveBeenCalledWith("p");
    // The failure the caller sees is unchanged from before the fix: a plain,
    // non-Prisma throw out of restoreBackup classifies as INTERNAL_ERROR
    // whether or not the cleanup call happens, since the cleanup is
    // fire-and-forget and never touches the rethrown error.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INTERNAL_ERROR");
    }
    expect(pruneKind).not.toHaveBeenCalled();
  });

  it("still surfaces the original restore failure even when cleaning up the safety snapshot also fails", async () => {
    isBackupStoreConfigured.mockReturnValue(true);
    vi.mocked(snapshotMock.inspectBackup).mockResolvedValue({ ok: true, format: 2, takenAt: "t", totalRows: 1 });
    backUpDatabase.mockResolvedValue({
      saved: { stamp: "s", pathname: "p", size: 1 },
      takenAt: "t",
      totalRows: 0,
    });
    vi.mocked(snapshotMock.restoreBackup).mockRejectedValue(new Error("FK violation"));
    vi.mocked(backupStoreMock.deleteBackup).mockRejectedValue(new Error("blob delete failed"));

    const res = await restoreFromBackup(restoreForm());

    expect(backupStoreMock.deleteBackup).toHaveBeenCalledWith("p");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/blob delete failed/);
    }
  });
});

describe("restoreFromUpload cleans up its safety snapshot on a failed restore", () => {
  function uploadForm(): FormData {
    const fd = new FormData();
    fd.set("confirm", CONFIRM_PHRASES.restore);
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "backup.json.gz"));
    return fd;
  }

  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(true);
    vi.mocked(snapshotMock.inspectBackup).mockResolvedValue({ ok: true, format: 2, takenAt: "t", totalRows: 1 });
    backUpDatabase.mockResolvedValue({
      saved: { stamp: "s", pathname: "p", size: 1 },
      takenAt: "t",
      totalRows: 0,
    });
  });

  it("passes the safety snapshot's pathname to deleteBackup and returns the original failure unchanged", async () => {
    vi.mocked(snapshotMock.restoreBackup).mockRejectedValue(new Error("FK violation"));

    const res = await restoreFromUpload(uploadForm());

    expect(backupStoreMock.deleteBackup).toHaveBeenCalledWith("p");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INTERNAL_ERROR");
    }
  });

  it("still surfaces the original failure when the cleanup delete also rejects", async () => {
    vi.mocked(snapshotMock.restoreBackup).mockRejectedValue(new Error("FK violation"));
    vi.mocked(backupStoreMock.deleteBackup).mockRejectedValue(new Error("blob delete failed"));

    const res = await restoreFromUpload(uploadForm());

    expect(backupStoreMock.deleteBackup).toHaveBeenCalledWith("p");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/blob delete failed/);
    }
  });
});

describe("undoLastOperation consumes its undo point best-effort", () => {
  const SAFETY = {
    kind: "safety" as const,
    pathname: "litrack/backups/safety/2026-09-25T10-00-00-000Z.ndjson.gz",
    size: 1,
    uploadedAt: new Date("2026-09-25T10:00:00.000Z"),
    stamp: "s",
  };

  beforeEach(() => {
    isBackupStoreConfigured.mockReturnValue(true);
    vi.mocked(backupStoreMock.latestSafetyBackup).mockResolvedValue(SAFETY);
    vi.mocked(snapshotMock.inspectBackup).mockResolvedValue({ ok: true, format: 2, takenAt: "t", totalRows: 1 });
    vi.mocked(snapshotMock.restoreBackup).mockResolvedValue({ School: 1 });
  });

  it("still reports success, writes the DB_ROLLBACK audit row and revalidates caches when deleting the consumed undo point fails", async () => {
    vi.mocked(backupStoreMock.deleteBackup).mockRejectedValue(new Error("blob delete failed"));

    const res = await undoLastOperation();

    expect(res.ok).toBe(true);
    expect(backupStoreMock.deleteBackup).toHaveBeenCalledWith(SAFETY.pathname);
    expect(lastAudit()).toMatchObject({ action: "DB_ROLLBACK" });
    expect(revalidateAllCachedData).toHaveBeenCalled();
  });
});
