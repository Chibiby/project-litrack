import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The unlock console: a Super Admin division-wide, or a district admin within
 * their own districts (`docs/specs/district-admin.md` 3.5).
 *
 * This is the highest-consequence pair of actions in the app after the database
 * danger zone: one of them hands every teacher in a school write access to a
 * window that had closed. Properties pinned deliberately:
 *
 * - **`requireAdminScope()` is the only gate.** Never a bare `requireUser` role
 *   check next to it — a School Head or teacher must be refused, and a district
 *   admin must never reach a school or grant outside their own districts.
 * - **Every target is loaded WITH the scope in its `where`**, never checked
 *   afterwards. `loadSchoolInScope` for a school (teacher or school mode);
 *   a `findFirst` carrying `school: schoolWhereForScope(scope)` for a grant
 *   being revoked.
 * - **The school is read from a row, never from the payload.** In teacher mode
 *   the schema refuses a `schoolId` outright; the grant's school comes from the
 *   teacher's own record.
 * - **A re-grant updates one row.** Two rows for one window would make "is it
 *   open?" depend on row order.
 * - **No name, no email, no learner anything reaches an audit row.**
 *
 * `@/lib/auth/admin-scope` is deliberately NOT mocked — it is pure (no Prisma,
 * no `server-only`), and the point of the scope tests here is to prove the real
 * `schoolWhereForScope` output reaches the grant lookup's `where`.
 * `@/lib/auth/district-scope` IS mocked, the same as the other action tests in
 * this directory mock their auth boundary — `requireAdminScope` and
 * `loadSchoolInScope` are the module's server half (Prisma, `requireUser`,
 * React `cache()`), out of scope for a unit test of this file's own logic.
 * `src/lib/unlock/issue.ts` is likewise NOT mocked — it is the module under
 * test as much as the actions are, because it is where the grant rows are
 * actually written.
 */

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const grantUpsert = vi.fn();
const grantFindUnique = vi.fn();
const grantFindFirst = vi.fn();
const grantUpdate = vi.fn();
const schoolGrantUpsert = vi.fn();
const schoolGrantFindUnique = vi.fn();
const schoolGrantFindFirst = vi.fn();
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
    unlockGrant: {
      get upsert() {
        return grantUpsert;
      },
      get findUnique() {
        return grantFindUnique;
      },
      get findFirst() {
        return grantFindFirst;
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
      get findFirst() {
        return schoolGrantFindFirst;
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

const requireAdminScope = vi.fn();
const loadSchoolInScope = vi.fn();
vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: () => requireAdminScope(),
  loadSchoolInScope: (...args: unknown[]) => loadSchoolInScope(...args),
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
const { AppError, resourceNotFound } = await import("@/lib/errors/app-error");
const { schoolWhereForScope } = await import("@/lib/auth/admin-scope");

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };
const DIVISION_SCOPE = { kind: "division" as const };
const DISTRICT_ADMIN = { id: "da-1", schoolId: null, role: "DISTRICT_ADMIN" };
const DISTRICT_SCOPE = { kind: "districts" as const, districts: ["Alabel 1"] };

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
  requireAdminScope.mockResolvedValue({ user: ADMIN, scope: DIVISION_SCOPE });
  // Default: whatever school id is asked for is "in scope" — the object it
  // resolves with is exactly what `loadSchoolInScope`'s real `select: {id:true}`
  // call would return.
  loadSchoolInScope.mockImplementation(async (_scope: unknown, schoolId: string) => ({
    id: schoolId,
  }));
  userFindFirst.mockResolvedValue({ id: TEACHER_ID, schoolId: SCHOOL_ID });
  userFindMany.mockResolvedValue([
    { id: "teacher-a" },
    { id: "teacher-b" },
    { id: "teacher-c" },
  ]);
  grantUpsert.mockResolvedValue({ id: GRANT_ID });
  schoolGrantUpsert.mockResolvedValue({ id: GRANT_ID });
  grantFindFirst.mockResolvedValue({ id: GRANT_ID });
  schoolGrantFindFirst.mockResolvedValue({ id: GRANT_ID });
  grantUpdate.mockResolvedValue({ id: GRANT_ID });
  schoolGrantUpdate.mockResolvedValue({ id: GRANT_ID });
  notificationCreate.mockResolvedValue({ id: "notif-1" });
  notificationCreateMany.mockResolvedValue({ count: 3 });
});

describe("issueUnlock — authorization", () => {
  it("refuses a School Head or teacher — requireAdminScope is the only gate", async () => {
    // The single most important test in this file. `requireAdminScope` throws
    // exactly what the real module throws for a role outside
    // ["SUPER_ADMIN", "DISTRICT_ADMIN"], so what is being asserted is that
    // this action has no second, looser path in.
    requireAdminScope.mockRejectedValue(
      new AppError("AUTH_FORBIDDEN", { params: { what: "the admin console" } })
    );

    const result = await issueUnlock(schoolGrant());

    expect(result).toEqual({
      ok: false,
      code: "AUTH_FORBIDDEN",
      error: "You don't have access to the admin console.",
    });
    noGrantWasWritten();
  });

  it("refuses just as flatly on revoke", async () => {
    requireAdminScope.mockRejectedValue(
      new AppError("AUTH_FORBIDDEN", { params: { what: "the admin console" } })
    );

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(result).toMatchObject({ ok: false, code: "AUTH_FORBIDDEN" });
    expect(schoolGrantUpdate).not.toHaveBeenCalled();
  });

  it("asks for the caller's admin scope before reading anything", async () => {
    await issueUnlock(teacherGrant());

    expect(requireAdminScope).toHaveBeenCalledTimes(1);
  });
});

describe("issueUnlock — district admin scope", () => {
  it("loads the teacher's school WITH the caller's scope, never checks it afterwards", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });

    await issueUnlock(teacherGrant());

    expect(loadSchoolInScope).toHaveBeenCalledWith(DISTRICT_SCOPE, SCHOOL_ID, { id: true });
  });

  it("refuses a teacher whose school is outside the caller's districts", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });
    loadSchoolInScope.mockRejectedValue(resourceNotFound("School", { crossTenant: true }));

    const result = await issueUnlock(teacherGrant());

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    noGrantWasWritten();
  });

  it("loads the named school WITH the caller's scope in school mode too", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });

    await issueUnlock(schoolGrant());

    expect(loadSchoolInScope).toHaveBeenCalledWith(DISTRICT_SCOPE, SCHOOL_ID, { id: true });
  });

  it("refuses a named school outside the caller's districts, and writes no grant", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });
    loadSchoolInScope.mockRejectedValue(resourceNotFound("School", { crossTenant: true }));

    const result = await issueUnlock(schoolGrant());

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    noGrantWasWritten();
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

  it("refuses a school that is missing, soft-deleted, or out of scope", async () => {
    loadSchoolInScope.mockRejectedValue(resourceNotFound("School"));

    const result = await issueUnlock(schoolGrant());

    expect(loadSchoolInScope).toHaveBeenCalledWith(DIVISION_SCOPE, SCHOOL_ID, { id: true });
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
  it("loads the grant WITH the caller's scope before revoking it", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });

    await revokeUnlock({ kind: "teacher", grantId: GRANT_ID });

    // The assertion this whole test fails without: with the scope filter
    // removed, the `where` would be `{ id: GRANT_ID }` alone.
    expect(grantFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: GRANT_ID,
      school: schoolWhereForScope(DISTRICT_SCOPE),
    });
  });

  it("refuses an out-of-scope grant id before either revoke function ever runs", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });
    grantFindFirst.mockResolvedValue(null);

    const result = await revokeUnlock({ kind: "teacher", grantId: GRANT_ID });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(grantUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("checks the school-grant table's own scope for a school-wide revoke", async () => {
    requireAdminScope.mockResolvedValue({ user: DISTRICT_ADMIN, scope: DISTRICT_SCOPE });
    schoolGrantFindFirst.mockResolvedValue(null);

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(schoolGrantFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: GRANT_ID,
      school: schoolWhereForScope(DISTRICT_SCOPE),
    });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(schoolGrantUpdate).not.toHaveBeenCalled();
  });

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
    schoolGrantFindFirst.mockResolvedValue(null);

    const result = await revokeUnlock({ kind: "school", grantId: GRANT_ID });

    expect(grantFindFirst).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses an id that is not a uuid before reading anything", async () => {
    const result = await revokeUnlock({ kind: "teacher", grantId: "all" });

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(grantFindFirst).not.toHaveBeenCalled();
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
