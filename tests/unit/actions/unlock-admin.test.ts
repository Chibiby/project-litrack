import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Super Admin unlock console.
 *
 * This is the highest-consequence pair of actions in the app after the database
 * danger zone: one of them hands every teacher in a school write access to a
 * window that had closed. Four properties are pinned deliberately.
 *
 * - **A School Head is refused.** `requireUser(["SUPER_ADMIN"])` proves the
 *   caller passed *a* role check, not that they are a Super Admin — the helper's
 *   `allowSuperAdmin` default means an admin satisfies every role list in the
 *   app. Reading that the other way round, the console needs its own equality
 *   check, and this is the test that fails if somebody ever deletes it.
 * - **The school is read from a row, never from the payload.** In teacher mode
 *   the schema refuses a `schoolId` outright; the grant's school comes from the
 *   teacher's own record.
 * - **A re-grant updates one row.** Two rows for one window would make "is it
 *   open?" depend on row order.
 * - **No name, no email, no learner anything reaches an audit row.**
 *
 * Mocked at the module boundary like the other action tests here: real Prisma,
 * real Supabase and real Redis are out of scope. `src/lib/unlock/issue.ts` is
 * deliberately NOT mocked — it is the module under test as much as the actions
 * are, because it is where the grant rows are actually written.
 */

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const schoolFindFirst = vi.fn();
const grantUpsert = vi.fn();
const grantFindUnique = vi.fn();
const grantUpdate = vi.fn();
const schoolGrantUpsert = vi.fn();
const schoolGrantFindUnique = vi.fn();
const schoolGrantUpdate = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      get findFirst() {
        return userFindFirst;
      },
      get findMany() {
        return userFindMany;
      },
    },
    school: {
      get findFirst() {
        return schoolFindFirst;
      },
    },
    unlockGrant: {
      get upsert() {
        return grantUpsert;
      },
      get findUnique() {
        return grantFindUnique;
      },
      get update() {
        return grantUpdate;
      },
    },
    schoolUnlockGrant: {
      get upsert() {
        return schoolGrantUpsert;
      },
      get findUnique() {
        return schoolGrantFindUnique;
      },
      get update() {
        return schoolGrantUpdate;
      },
    },
    notification: {
      get create() {
        return notificationCreate;
      },
      get createMany() {
        return notificationCreateMany;
      },
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: {
    UNLOCK_GRANT_ISSUE: "UNLOCK_GRANT_ISSUE",
    UNLOCK_GRANT_REVOKE: "UNLOCK_GRANT_REVOKE",
    UNLOCK_SCHOOL_GRANT_ISSUE: "UNLOCK_SCHOOL_GRANT_ISSUE",
    UNLOCK_SCHOOL_GRANT_REVOKE: "UNLOCK_SCHOOL_GRANT_REVOKE",
  },
}));

const revalidateUnlockGrants = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateUnlockGrants: (...a: unknown[]) => revalidateUnlockGrants(...a),
}));

const reportError = vi.fn(() => "E-TESTREF9");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

const { issueUnlock, revokeUnlock } = await import("@/lib/actions/unlock-admin");

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };
const HEAD = { id: "head-1", schoolId: "school-1", role: "SCHOOL_HEAD" };

const TEACHER_ID = "0f1e2d3c-4b5a-4968-8776-655443332211";
const SCHOOL_ID = "11112222-3333-4444-8555-666677778888";
const GRANT_ID = "9b1e4f0a-2c3d-4e5f-8a7b-6c5d4e3f2a10";
const MONTH = "2026-09-01";
const WEEK = "2026-08-24";

/** Names and an email nothing this module writes is allowed to carry. */
const TEACHER_NAME = "Dela Cruz, Marites";
const TEACHER_EMAIL = "marites.delacruz@deped.gov.ph";

function teacherGrant(overrides: Record<string, unknown> = {}) {
  return {
    mode: "teacher",
    userId: TEACHER_ID,
    scope: "ARAL_WEEKLY_ATTENDANCE",
    targetKey: WEEK,
    days: 7,
    ...overrides,
  };
}

function schoolGrant(overrides: Record<string, unknown> = {}) {
  return {
    mode: "school",
    schoolId: SCHOOL_ID,
    scope: "MONTHLY_READING_LEVEL",
    targetKey: MONTH,
    days: 14,
    ...overrides,
  };
}

/** Every value that reached an audit row or a notification, flattened to text. */
function allWrittenText(): string {
  return JSON.stringify([
    writeAudit.mock.calls,
    notificationCreate.mock.calls,
    notificationCreateMany.mock.calls,
  ]);
}

function noGrantWasWritten() {
  expect(grantUpsert).not.toHaveBeenCalled();
  expect(schoolGrantUpsert).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  userFindFirst.mockResolvedValue({ id: TEACHER_ID, schoolId: SCHOOL_ID });
  userFindMany.mockResolvedValue([
    { id: "teacher-a" },
    { id: "teacher-b" },
    { id: "teacher-c" },
  ]);
  schoolFindFirst.mockResolvedValue({ id: SCHOOL_ID });
  grantUpsert.mockResolvedValue({ id: GRANT_ID });
  schoolGrantUpsert.mockResolvedValue({ id: GRANT_ID });
  grantUpdate.mockResolvedValue({ id: GRANT_ID });
  schoolGrantUpdate.mockResolvedValue({ id: GRANT_ID });
  notificationCreate.mockResolvedValue({ id: "notif-1" });
  notificationCreateMany.mockResolvedValue({ count: 3 });
});

describe("issueUnlock — authorization", () => {
  it("refuses a School Head", async () => {
    // The single most important test in this file. `requireUser` is mocked to
    // let the head through exactly as a flipped `allowSuperAdmin` default or an
    // edited role list would, so what is being asserted is the console's own
    // equality check and nothing else.
    requireUser.mockResolvedValue(HEAD);

    const result = await issueUnlock(schoolGrant());

    expect(result).toEqual({
      ok: false,
      code: "AUTH_FORBIDDEN",
      error: "You don't have access to the unlock console.",
    });
    noGrantWasWritten();
  });

  it("refuses a teacher just as flatly", async () => {
    requireUser.mockResolvedValue({ id: "t-9", schoolId: "school-1", role: "TEACHER" });

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(result).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(schoolGrantUpdate).not.toHaveBeenCalled();
  });

  it("asks the session for a Super Admin before reading anything", async () => {
    await issueUnlock(teacherGrant());

    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  });
});

describe("issueUnlock — validation", () => {
  it("rejects a target key that is not the first of a month for MONTHLY_READING_LEVEL", async () => {
    const result = await issueUnlock(schoolGrant({ targetKey: "2026-09-17" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (result.ok) return;
    expect(result.error).toBe("Choose a month");
    expect(result.fieldErrors?.targetKey).toBe("Choose a month");
    noGrantWasWritten();
  });

  it("refuses 500 days outright rather than clamping it to the maximum", async () => {
    // Clamping would hand three months of access to somebody who meant to type
    // 5 and never tell them they had mistyped.
    const result = await issueUnlock(teacherGrant({ days: 500 }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (result.ok) return;
    expect(result.error).toBe("Access cannot last more than 90 days");
    noGrantWasWritten();
  });

  it("accepts 90 days, the new shared maximum", async () => {
    const result = await issueUnlock(teacherGrant({ days: 90 }));

    expect(result).toMatchObject({ ok: true });
    expect(grantUpsert).toHaveBeenCalledTimes(1);
  });

  it("refuses a teacher-mode payload that also names a school", async () => {
    const result = await issueUnlock(teacherGrant({ schoolId: SCHOOL_ID }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (result.ok) return;
    expect(result.fieldErrors?.schoolId).toBe(
      "Choose either one teacher or one school, not both"
    );
    noGrantWasWritten();
  });

  it("refuses a school-mode payload with no school", async () => {
    const result = await issueUnlock(schoolGrant({ schoolId: "" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (result.ok) return;
    expect(result.fieldErrors?.schoolId).toBe("Choose a school");
    noGrantWasWritten();
  });
});

describe("issueUnlock — teacher mode", () => {
  it("takes the school from the teacher's row, never from the payload", async () => {
    const result = await issueUnlock(teacherGrant());

    expect(result).toMatchObject({ ok: true });
    // The full `where`, not a subset: `findUnlockRecipient` must accept exactly
    // what the picker offers (`role: "TEACHER"` plus `TEACHER_ROSTER_STATE.active`)
    // — never a wider set that lets a grant target a School Head or a PENDING /
    // deactivated teacher who cannot actually use it.
    expect(userFindFirst.mock.calls[0]?.[0]).toEqual({
      where: {
        id: TEACHER_ID,
        deletedAt: null,
        schoolId: { not: null },
        role: "TEACHER",
        approvalStatus: "APPROVED",
        isActive: true,
      },
      // Ids only. A name never loads, so a name can never be written.
      select: { id: true, schoolId: true },
    });
    expect(grantUpsert.mock.calls[0]?.[0]?.create).toMatchObject({
      schoolId: SCHOOL_ID,
      userId: TEACHER_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK,
      grantedById: "admin-1",
    });
  });

  it("upserts on the unique tuple and clears any previous revocation", async () => {
    // A re-grant must UPDATE the one row for this window. A second row would
    // leave "is it open?" depending on which one a read saw first, and a fresh
    // expiry on a still-revoked row reads as granted while granting nothing.
    await issueUnlock(teacherGrant());

    const call = grantUpsert.mock.calls[0]?.[0];
    expect(call.where.userId_scope_targetKey).toEqual({
      userId: TEACHER_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK,
    });
    expect(call.update).toMatchObject({
      grantedById: "admin-1",
      revokedAt: null,
      revokedById: null,
    });
    expect(grantUpsert).toHaveBeenCalledTimes(1);
  });

  it("dates the expiry the requested number of days out", async () => {
    const before = Date.now();

    await issueUnlock(teacherGrant({ days: 7 }));

    const expiresAt: Date = grantUpsert.mock.calls[0]?.[0]?.create?.expiresAt;
    const days = (expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("tells the one teacher, and busts only their caches", async () => {
    const result = await issueUnlock(teacherGrant());

    expect(notificationCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      schoolId: SCHOOL_ID,
      recipientId: TEACHER_ID,
      actorId: "admin-1",
      type: "UNLOCK_GRANTED",
      learnerIds: [],
      unlockGrantId: GRANT_ID,
    });
    expect(revalidateUnlockGrants).toHaveBeenCalledWith({ recipientIds: [TEACHER_ID] });
    expect(result).toMatchObject({ ok: true, data: { id: GRANT_ID, recipients: 1 } });
  });

  it("says the same 'not found' for a removed teacher as for one that never existed", async () => {
    // Also stands in for a School Head, a PENDING teacher, or a deactivated one:
    // `findUnlockRecipient`'s `where` excludes all of them, so Prisma returns
    // null for each exactly as it does here, and no grant row gets written.
    userFindFirst.mockResolvedValue(null);

    const result = await issueUnlock(teacherGrant());

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    if (result.ok) return;
    expect(result.error).toContain("Teacher not found");
    noGrantWasWritten();
  });

  it("refuses a teacher whose account carries no school", async () => {
    userFindFirst.mockResolvedValue({ id: TEACHER_ID, schoolId: null });

    const result = await issueUnlock(teacherGrant());

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    noGrantWasWritten();
  });
});

describe("issueUnlock — school mode", () => {
  it("writes exactly one grant row and one notification per active teacher", async () => {
    const result = await issueUnlock(schoolGrant());

    expect(schoolGrantUpsert).toHaveBeenCalledTimes(1);
    expect(grantUpsert).not.toHaveBeenCalled();
    expect(schoolGrantUpsert.mock.calls[0]?.[0]?.where.schoolId_scope_targetKey).toEqual({
      schoolId: SCHOOL_ID,
      scope: "MONTHLY_READING_LEVEL",
      targetKey: MONTH,
    });

    const rows = notificationCreateMany.mock.calls[0]?.[0]?.data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      schoolId: SCHOOL_ID,
      recipientId: "teacher-a",
      actorId: "admin-1",
      type: "UNLOCK_GRANTED",
      learnerIds: [],
      schoolUnlockGrantId: GRANT_ID,
    });
    expect(result).toMatchObject({ ok: true, data: { id: GRANT_ID, recipients: 3 } });
  });

  it("notifies the school's active, approved, non-deleted teachers", async () => {
    await issueUnlock(schoolGrant());

    expect(userFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      schoolId: SCHOOL_ID,
      role: "TEACHER",
      deletedAt: null,
      isActive: true,
      approvalStatus: "APPROVED",
    });
  });

  it("clears a previous revocation on a re-grant instead of stacking a row", async () => {
    await issueUnlock(schoolGrant());

    expect(schoolGrantUpsert.mock.calls[0]?.[0]?.update).toMatchObject({
      grantedById: "admin-1",
      revokedAt: null,
      revokedById: null,
    });
  });

  it("still issues for a school with nobody to tell", async () => {
    userFindMany.mockResolvedValue([]);

    const result = await issueUnlock(schoolGrant());

    expect(result).toMatchObject({ ok: true, data: { recipients: 0 } });
    expect(schoolGrantUpsert).toHaveBeenCalledTimes(1);
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("refuses a school that is missing or soft-deleted", async () => {
    schoolFindFirst.mockResolvedValue(null);

    const result = await issueUnlock(schoolGrant());

    expect(schoolFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: SCHOOL_ID,
      deletedAt: null,
    });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    noGrantWasWritten();
  });
});

describe("issueUnlock — audit", () => {
  it("records ids, the window and the expiry, and no name or email", async () => {
    userFindFirst.mockResolvedValue({
      id: TEACHER_ID,
      schoolId: SCHOOL_ID,
      // Not selected by the action, but present here so the assertion below is
      // proving something even if somebody widens that select later.
      fullName: TEACHER_NAME,
      email: TEACHER_EMAIL,
    });

    await issueUnlock(teacherGrant());

    const written = allWrittenText();
    expect(written).not.toContain(TEACHER_NAME);
    expect(written).not.toContain(TEACHER_EMAIL);
    expect(written).not.toContain("Dela Cruz");

    const entry = writeAudit.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      userId: "admin-1",
      schoolId: SCHOOL_ID,
      action: "UNLOCK_GRANT_ISSUE",
      resource: "UnlockGrant",
      resourceId: GRANT_ID,
    });
    expect(Object.keys(entry.metadata).sort()).toEqual([
      "direct",
      "expiresAt",
      "scope",
      "targetKey",
      "ticketId",
      "userId",
    ]);
    expect(typeof entry.metadata.expiresAt).toBe("string");
  });

  it("records a school grant by count, not by who was told", async () => {
    await issueUnlock(schoolGrant());

    const entry = writeAudit.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      userId: "admin-1",
      schoolId: SCHOOL_ID,
      action: "UNLOCK_SCHOOL_GRANT_ISSUE",
      resource: "SchoolUnlockGrant",
      resourceId: GRANT_ID,
    });
    expect(entry.metadata).toMatchObject({
      scope: "MONTHLY_READING_LEVEL",
      targetKey: MONTH,
      recipients: 3,
    });
    expect(Object.keys(entry.metadata)).not.toContain("recipientIds");
  });
});

describe("revokeUnlock", () => {
  it("marks a teacher grant revoked instead of deleting it", async () => {
    grantFindUnique.mockResolvedValue({
      id: GRANT_ID,
      schoolId: SCHOOL_ID,
      userId: TEACHER_ID,
      scope: "ARAL_WEEKLY_ATTENDANCE",
      targetKey: WEEK,
      revokedAt: null,
    });

    const result = await revokeUnlock({ kind: "teacher", grantId: GRANT_ID });

    expect(result).toEqual({ ok: true });
    expect(grantUpdate.mock.calls[0]?.[0]?.data).toMatchObject({ revokedById: "admin-1" });
    expect(grantUpdate.mock.calls[0]?.[0]?.data.revokedAt).toBeInstanceOf(Date);
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: "UNLOCK_GRANT_REVOKE",
      resourceId: GRANT_ID,
    });
    expect(revalidateUnlockGrants).toHaveBeenCalledWith({ recipientIds: [TEACHER_ID] });
  });

  it("marks a school grant revoked and busts every teacher's caches", async () => {
    schoolGrantFindUnique.mockResolvedValue({
      id: GRANT_ID,
      schoolId: SCHOOL_ID,
      scope: "MONTHLY_READING_LEVEL",
      targetKey: MONTH,
      revokedAt: null,
    });

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(result).toEqual({ ok: true });
    expect(schoolGrantUpdate.mock.calls[0]?.[0]?.data.revokedAt).toBeInstanceOf(Date);
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: "UNLOCK_SCHOOL_GRANT_REVOKE",
      resourceId: GRANT_ID,
    });
    expect(revalidateUnlockGrants).toHaveBeenCalledWith({
      recipientIds: ["teacher-a", "teacher-b", "teacher-c"],
    });
  });

  it("is idempotent: a second revoke writes nothing and audits nothing", async () => {
    // Otherwise a double click would move the timestamp that records when the
    // window actually closed again.
    schoolGrantFindUnique.mockResolvedValue({
      id: GRANT_ID,
      schoolId: SCHOOL_ID,
      scope: "MONTHLY_READING_LEVEL",
      targetKey: MONTH,
      revokedAt: new Date("2026-09-02T01:00:00.000Z"),
    });

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(result).toEqual({ ok: true });
    expect(schoolGrantUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("looks only in the table `kind` names", async () => {
    // A teacher grant id passed as `kind: "school"` is indistinguishable from a
    // grant that does not exist, which is exactly what it should look like.
    schoolGrantFindUnique.mockResolvedValue(null);

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(grantFindUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses an id that is not a uuid before reading anything", async () => {
    const result = await revokeUnlock({ kind: "teacher", grantId: "all" });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(grantFindUnique).not.toHaveBeenCalled();
  });
});

describe("the action() failure shape", () => {
  it("answers every failure with { ok, code, error } and no stack trace", async () => {
    grantUpsert.mockRejectedValue(new Error("connection reset by peer"));

    const result = await issueUnlock(teacherGrant());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.code).toBe("string");
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toContain("connection reset");
    // A failure on our side earns a reference an admin can look up.
    expect(result.ref).toBe("E-TESTREF9");
  });
});
