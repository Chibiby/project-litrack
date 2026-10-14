import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * restoreDeletedLearner: Developer / Division admins restore any school's
 * soft-deleted learner, a District Admin only one inside an assigned district.
 *
 * The real `requireAdminScope` / `schoolWhereForScope` run here (only the
 * session and Prisma are mocked), so the refusals and the scope in the WHERE
 * are the production ones, not stand-ins.
 */

const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID = "school-1";

const learnerFindFirst = vi.fn();
const assignmentFindMany = vi.fn();
const learnerUpdate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      get findFirst() {
        return learnerFindFirst;
      },
    },
    districtAdminAssignment: {
      get findMany() {
        return assignmentFindMany;
      },
    },
    get $transaction() {
      return transaction;
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF00") }));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: { ARCHIVE_LEARNER_RESTORE: "ARCHIVE_LEARNER_RESTORE" },
}));

const reactivateEnrollment = vi.fn();
vi.mock("@/lib/learners/reactivate-enrollment", () => ({
  reactivateEnrollment: (...args: unknown[]) => reactivateEnrollment(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...a: unknown[]) => revalidateLearnerScoped(...a),
}));

const { restoreDeletedLearner } = await import("@/lib/actions/deleted-learners");
const { redirect } = await import("next/navigation");

function fd(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  return form;
}

const deletedLearner = {
  id: LEARNER_ID,
  schoolId: SCHOOL_ID,
  gradeLevelId: "grade-1",
  sectionId: "section-1",
  teacherId: "teacher-1",
  aralTeacherId: null,
  isAralLearner: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" });
  checkRateLimit.mockResolvedValue({ ok: true });
  assignmentFindMany.mockResolvedValue([]);
  learnerFindFirst.mockResolvedValue(deletedLearner);
  reactivateEnrollment.mockResolvedValue({ outcome: "revived", enrollmentId: "enrollment-9" });
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ learner: { update: learnerUpdate } })
  );
});

describe("authorization", () => {
  it.each(["TEACHER", "SCHOOL_HEAD"])("refuses a %s that reaches the action", async (role) => {
    requireUser.mockResolvedValue({ id: "u-1", role });

    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toMatchObject({ ok: false });
    expect(learnerFindFirst).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("propagates the redirect requireUser issues for a signed-out or wrong-role caller", async () => {
    requireUser.mockImplementation(async () => {
      redirect("/login");
    });

    await expect(restoreDeletedLearner(fd(LEARNER_ID))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(learnerFindFirst).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("asks requireUser for SUPER_ADMIN and DISTRICT_ADMIN only, without the impersonation default", async () => {
    await restoreDeletedLearner(fd(LEARNER_ID));
    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN", "DISTRICT_ADMIN"], false);
  });
});

describe("scope", () => {
  it("a division admin restores a learner from any school (no district filter in the WHERE)", async () => {
    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toEqual({ ok: true, enrollmentOutcome: "revived" });
    const where = learnerFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: LEARNER_ID });
    expect(where.OR).toContainEqual({ deletedAt: { not: null } });
    expect(JSON.stringify(where)).not.toContain("district");
  });

  it("a district admin's lookup carries their districts and excludes demo schools", async () => {
    requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN" });
    assignmentFindMany.mockResolvedValue([{ district: "North" }, { district: "East" }]);

    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toMatchObject({ ok: true });
    const where = learnerFindFirst.mock.calls[0][0].where;
    expect(where.school.AND[0]).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["East", "North"] },
    });
  });

  it("a district admin cannot restore a learner from a school outside their districts: NOT_FOUND, no write", async () => {
    requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN" });
    assignmentFindMany.mockResolvedValue([{ district: "North" }]);
    // The scoped WHERE does not match an out-of-scope row, exactly as for a missing id.
    learnerFindFirst.mockResolvedValue(null);

    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(learnerFindFirst.mock.calls[0][0].where.school.AND[0].district).toEqual({ in: ["North"] });
    expect(transaction).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a district admin with no assigned districts matches no school", async () => {
    requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN" });
    assignmentFindMany.mockResolvedValue([]);
    learnerFindFirst.mockResolvedValue(null);

    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(learnerFindFirst.mock.calls[0][0].where.school.AND[0].district).toEqual({ in: [] });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });
});

describe("restore", () => {
  it("clears both deletedAt and archivedAt, reactivates the enrollment, audits ids only", async () => {
    const res = await restoreDeletedLearner(fd(LEARNER_ID));

    expect(res).toEqual({ ok: true, enrollmentOutcome: "revived" });
    expect(learnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_ID },
      data: { deletedAt: null, archivedAt: null },
    });
    expect(reactivateEnrollment).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit.mock.calls[0][0]).toMatchObject({
      userId: "admin-1",
      schoolId: SCHOOL_ID,
      action: "ARCHIVE_LEARNER_RESTORE",
      resource: "Learner",
      resourceId: LEARNER_ID,
      metadata: {
        schoolId: SCHOOL_ID,
        scope: "division",
        enrollmentOutcome: "revived",
        enrollmentId: "enrollment-9",
      },
    });
    expect(revalidateLearnerScoped).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_ID, adminDashboard: true, teacherShell: true })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/deleted-learners");
    expect(revalidatePath).toHaveBeenCalledWith("/district/deleted-learners");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/archive");
  });

  it("only reaches soft-deleted learners in live schools", async () => {
    await restoreDeletedLearner(fd(LEARNER_ID));
    const where = learnerFindFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ deletedAt: { not: null } });
    expect(where.school.AND).toContainEqual({ deletedAt: null });
  });

  describe("removal expired but not yet soft-deleted", () => {
    afterEach(() => vi.useRealTimers());
    const CUTOFF = new Date("2026-11-01T00:00:00.000Z");

    function expireClock() {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    }

    it("a division admin restores it, clearing archivedAt, and the lookup requires the expired branch", async () => {
      expireClock();
      const res = await restoreDeletedLearner(fd(LEARNER_ID));

      expect(res).toEqual({ ok: true, enrollmentOutcome: "revived" });
      const where = learnerFindFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { deletedAt: { not: null } },
        { deletedAt: null, archivedAt: { not: null, lt: CUTOFF } },
      ]);
      expect(learnerUpdate).toHaveBeenCalledWith({
        where: { id: LEARNER_ID },
        data: { deletedAt: null, archivedAt: null },
      });
    });

    it("a district admin keeps the district scope next to the expiry branch; out of scope is NOT_FOUND", async () => {
      expireClock();
      requireUser.mockResolvedValue({ id: "da-1", role: "DISTRICT_ADMIN" });
      assignmentFindMany.mockResolvedValue([{ district: "North" }]);
      learnerFindFirst.mockResolvedValue(null);

      const res = await restoreDeletedLearner(fd(LEARNER_ID));

      expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
      const where = learnerFindFirst.mock.calls[0][0].where;
      expect(where.school.AND[0].district).toEqual({ in: ["North"] });
      expect(where.OR).toHaveLength(2);
      expect(learnerUpdate).not.toHaveBeenCalled();
    });

    it("a removal still inside its 30 days matches neither branch: NOT_FOUND for every admin", async () => {
      expireClock();
      learnerFindFirst.mockResolvedValue(null);
      for (const role of ["SUPER_ADMIN", "DISTRICT_ADMIN"]) {
        requireUser.mockResolvedValue({ id: "a-1", role });
        assignmentFindMany.mockResolvedValue([{ district: "North" }]);
        const res = await restoreDeletedLearner(fd(LEARNER_ID));
        expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
      }
      // The only way in is a cutoff bound on archivedAt: in-window rows are excluded.
      const where = learnerFindFirst.mock.calls[0][0].where;
      expect(where.OR[1].archivedAt.lt).toEqual(CUTOFF);
      expect(learnerUpdate).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    });
  });

  it("rejects a non-uuid id before touching the database", async () => {
    const res = await restoreDeletedLearner(fd("not-an-id"));
    expect(res).toMatchObject({ ok: false });
    expect(learnerFindFirst).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });
    const res = await restoreDeletedLearner(fd(LEARNER_ID));
    expect(res).toMatchObject({ ok: false });
    expect(learnerFindFirst).not.toHaveBeenCalled();
  });
});
