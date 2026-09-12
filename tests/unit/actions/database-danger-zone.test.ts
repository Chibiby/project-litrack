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
const saveBackup = vi.fn();
vi.mock("@/lib/db/backup-store", () => ({
  BACKUP_STORE_SETUP_MESSAGE: "Backup storage is not connected.",
  isBackupStoreConfigured: () => isBackupStoreConfigured(),
  saveBackup: (...a: unknown[]) => saveBackup(...a),
  deleteBackup: vi.fn(),
  latestSafetyBackup: vi.fn(),
  parseUploadedBackup: vi.fn(),
  readBackup: vi.fn(),
}));

const createSnapshot = vi.fn();
const clearOperationalData = vi.fn();
vi.mock("@/lib/db/snapshot", () => ({
  createSnapshot: (...a: unknown[]) => createSnapshot(...a),
  clearOperationalData: (...a: unknown[]) => clearOperationalData(...a),
  restoreSnapshot: vi.fn(),
  validateSnapshot: vi.fn(),
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Imported after the mock factories above are registered.
const { removeAllTeachers, resetAllSchoolAccounts, resetOperationalData } = await import(
  "@/lib/actions/database"
);
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
  createSnapshot.mockResolvedValue({ meta: { totalRows: 0 } });
  saveBackup.mockResolvedValue({ stamp: "2026-09-10T00:00:00.000Z", pathname: "p", size: 1 });
  clearOperationalData.mockResolvedValue({ Learner: 12 });
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

    expect(res).toEqual({ ok: false, error: "Backup storage is not connected." });
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("refuses when the acknowledgement is present but not the exact phrase", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, "yes"));

    expect(res.ok).toBe(false);
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("still requires the typed confirmation phrase alongside the acknowledgement", async () => {
    const res = await resetOperationalData(form("clear data", CONFIRM_PHRASES.noBackupAck));

    expect(res).toEqual({ ok: false, error: `Type ${CONFIRM_PHRASES.resetOperational} to confirm.` });
    expect(clearOperationalData).not.toHaveBeenCalled();
  });

  it("clears operational data once acknowledged, without attempting a snapshot", async () => {
    const res = await resetOperationalData(form(CONFIRM_PHRASES.resetOperational, CONFIRM_PHRASES.noBackupAck));

    expect(res).toEqual({ ok: true, data: { removed: { Learner: 12 } } });
    expect(clearOperationalData).toHaveBeenCalledTimes(1);
    expect(saveBackup).not.toHaveBeenCalled();
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
    expect(saveBackup).toHaveBeenCalledWith("safety", expect.anything());
    expect(lastAudit()).toMatchObject({
      metadata: { safetyStamp: "2026-09-10T00:00:00.000Z", reversible: true },
    });
  });

  it("refuses when the snapshot fails, acknowledgement or not", async () => {
    saveBackup.mockRejectedValue(new Error("blob write failed"));

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

    expect(res).toEqual({ ok: false, error: "That school no longer exists." });
    expect(clearOperationalData).not.toHaveBeenCalled();
    expect(saveBackup).not.toHaveBeenCalled();
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
    expect(createSnapshot).not.toHaveBeenCalled();
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
