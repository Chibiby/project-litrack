import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teacher "Delete permanently" on the Archived Learners tab. Pins: only
 * archived/removed learners are reachable, tenant + teacher scope mirror
 * restoreLearner, the typed name must match, and the audit row carries ids and
 * counts only.
 */

const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const NAME = "Juan  dela Cruz";

const learnerFindFirst = vi.fn();
const transaction = vi.fn();
const txLearnerFindFirst = vi.fn();
const txQueryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      get findFirst() {
        return learnerFindFirst;
      },
    },
    get $transaction() {
      return transaction;
    },
  },
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...args),
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: { ARCHIVE_LEARNER_PURGE: "ARCHIVE_LEARNER_PURGE" },
}));

const purgeLearnerRecord = vi.fn();
// Delegates to `purgeLearnerRecord`; one test swaps in the REAL helper so the
// delete guard itself is exercised, not just the call.
vi.mock("@/lib/archive/purge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/archive/purge")>(
    "@/lib/archive/purge"
  );
  return {
    purgeLearnerRecord: (...args: unknown[]) =>
      useRealPurge
        ? (actual.purgeLearnerRecord as (...a: unknown[]) => unknown)(...args)
        : purgeLearnerRecord(...args),
  };
});
vi.mock("@/lib/teachers/release-advisory", () => ({ releaseTeacherAdvisory: vi.fn() }));
vi.mock("server-only", () => ({}));
let useRealPurge = false;

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...args: unknown[]) => revalidateLearnerScoped(...args),
}));

const { purgeArchivedLearner } = await import("@/lib/actions/learner-purge");

function fd(confirmName: string, id = LEARNER_ID): FormData {
  const form = new FormData();
  form.set("id", id);
  form.set("confirmName", confirmName);
  return form;
}

function archived(overrides: Record<string, unknown> = {}) {
  return {
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    fullName: NAME,
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    isAralLearner: false,
    gradeLevelId: "grade-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRealPurge = false;
  requireSchoolUser.mockResolvedValue({ id: TEACHER_ID, role: "TEACHER", schoolId: SCHOOL_ID });
  checkRateLimit.mockResolvedValue({ ok: true });
  learnerFindFirst.mockResolvedValue(archived());
  purgeLearnerRecord.mockResolvedValue({ enrollment: 1, attendance: 2 });
  txLearnerFindFirst.mockResolvedValue({ id: LEARNER_ID });
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ $queryRaw: txQueryRaw, learner: { findFirst: txLearnerFindFirst } })
  );
});

it("deletes an archivedAt-only learner through the real purge helper", async () => {
  useRealPurge = true;
  const count = vi.fn(async () => 0);
  const deleteMany = vi.fn(async (args: { where: { OR?: unknown[]; deletedAt?: unknown } }) => ({
    // Mimic the DB: an archivedAt-only row matches only a guard with that branch.
    count: args.where.OR ? 1 : 0,
  }));
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $queryRaw: txQueryRaw,
      learner: { findFirst: txLearnerFindFirst, deleteMany },
      enrollment: { count },
      attendance: { count },
      readingLevelRecord: { count },
      termGrade: { count },
      aralProfile: { count },
      aralMosyDecision: { count },
      kinderCompetencyRecord: { count },
    })
  );

  expect(await purgeArchivedLearner(fd(NAME))).toEqual({ ok: true });
  expect(deleteMany).toHaveBeenCalledWith({
    where: {
      id: LEARNER_ID,
      OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }],
    },
  });
  expect(writeAudit).toHaveBeenCalledTimes(1);
});

it("does not purge when the learner was restored before the in-transaction re-check", async () => {
  txLearnerFindFirst.mockResolvedValue(null);
  const res = await purgeArchivedLearner(fd(NAME));
  expect(res).toMatchObject({ ok: false });
  // The re-read repeats tenant, archived-or-removed AND adviser-or-ARAL-tutor.
  expect(txLearnerFindFirst.mock.calls[0][0].where).toEqual({
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    AND: [
      { OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }] },
      { OR: [{ teacherId: TEACHER_ID }, { aralTeacherId: TEACHER_ID }] },
    ],
  });
  expect(purgeLearnerRecord).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
});

describe("purgeArchivedLearner", () => {
  it("purges an archived learner and audits ids and counts only", async () => {
    const res = await purgeArchivedLearner(fd("  juan DELA   cruz "));

    expect(res).toEqual({ ok: true });
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
    expect(checkRateLimit).toHaveBeenCalledWith(
      `teacher:learner:purge:${TEACHER_ID}`,
      expect.anything()
    );
    expect(purgeLearnerRecord).toHaveBeenCalledWith(expect.anything(), LEARNER_ID, {
      acceptArchived: true,
    });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit).toMatchObject({
      userId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      action: "ARCHIVE_LEARNER_PURGE",
      resourceId: LEARNER_ID,
      metadata: { schoolId: SCHOOL_ID, counts: { enrollment: 1, attendance: 2 }, by: "TEACHER" },
    });
    expect(JSON.stringify(audit)).not.toContain("Cruz");
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/learners");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/archive");
  });

  it("only looks up archived or removed learners in the caller's school", async () => {
    await purgeArchivedLearner(fd(NAME));
    expect(learnerFindFirst.mock.calls[0][0].where).toEqual({
      id: LEARNER_ID,
      schoolId: SCHOOL_ID,
      OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }],
    });
  });

  it("treats an active learner as not found and deletes nothing", async () => {
    learnerFindFirst.mockResolvedValue(null);
    const res = await purgeArchivedLearner(fd(NAME));
    expect(res).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(purgeLearnerRecord).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("treats a learner from another school as not found", async () => {
    learnerFindFirst.mockResolvedValue(archived({ schoolId: "school-2" }));
    const res = await purgeArchivedLearner(fd(NAME));
    expect(res).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("treats a learner the teacher has no access to as not found", async () => {
    learnerFindFirst.mockResolvedValue(archived({ teacherId: "other", aralTeacherId: null }));
    const res = await purgeArchivedLearner(fd(NAME));
    expect(res).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("allows the designated ARAL teacher", async () => {
    learnerFindFirst.mockResolvedValue(archived({ teacherId: null, aralTeacherId: TEACHER_ID }));
    expect(await purgeArchivedLearner(fd(NAME))).toEqual({ ok: true });
  });

  it("rejects a wrong confirmName with a field error and deletes nothing", async () => {
    const res = await purgeArchivedLearner(fd("Juan dela Cruz Jr"));
    expect(res).toMatchObject({
      ok: false,
      fieldErrors: { confirmName: "Type the learner's name exactly to confirm" },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(purgeLearnerRecord).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
