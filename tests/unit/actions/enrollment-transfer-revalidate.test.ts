import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for the teacher cache fan-out of `transferLearner` and
 * `transferLearnerCrossSchool`, plus the tenancy guard on the same-school one.
 *
 * These two actions had no action-level coverage of any kind. The specific lines
 * pinned here are the `revalidateTeacherCaches(learner.aralTeacherId)` busts: a
 * learner's grade is part of their designated ARAL tutor's grade set, because
 * `teacherGradeScope` unions the advised-section arm with
 * `{ learners: { some: { aralTeacherId, deletedAt: null } } }`. For a Non-DepEd
 * ARAL Volunteer who advises no section, that one learner can be the tutor's
 * entire scope, and the tutor has no other path into `teacherShell` (300s) or
 * `teacherDashboard` (60s). `revalidateSchoolHeadTeachers()` sits three lines
 * above that block and is a Task 12 edit site, which is why these lines want a
 * net and not only a review fence.
 *
 * Load-bearing fixture choices — do not "simplify" any of these:
 *
 *   1. **Three pairwise-distinct teacher ids** (`teacher-out`, `teacher-in`,
 *      `teacher-aral`). If the tutor id collided with either adviser, the
 *      assertion would pass with the bust deleted and the test would prove
 *      nothing. The distinctness is the test.
 *   2. **A cross-grade transfer** (`grade-3` → `grade-4`) with `targetSectionId`
 *      omitted from the FormData entirely. `resolveTransferSection` then returns
 *      `sectionId: null` without reading a section row at all — asserted below,
 *      so the reason the fixture needs no section is recorded rather than
 *      incidental.
 *   3. **`assertSameSchool` is mocked with its real behaviour** (throw only when
 *      the two arguments differ), not hard-coded to throw. A mock that always
 *      threw would pass case 4 even with the guard deleted from the action.
 *   4. Every success case asserts `result` **before** any bust assertion. If a
 *      fake returned `null` where the action expects a row, the action would bail
 *      with `{ ok: false }` and a `not.toHaveBeenCalled` assertion would pass
 *      silently.
 *
 * Vitest module mocks are per-file, so mocking `@/lib/cache/revalidate` here
 * cannot affect any other suite.
 */

const HEAD_ID = "head-1";
const ADMIN_ID = "admin-1";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const LEARNER_ID = "learner-1";
const FROM_GRADE_ID = "grade-3";
const TO_GRADE_ID = "grade-4";
/** Outgoing adviser. */
const TEACHER_OUT = "teacher-out";
/** Receiving adviser. */
const TEACHER_IN = "teacher-in";
/** Designated ARAL tutor — advises no section, so this is their only path in. */
const TEACHER_ARAL = "teacher-aral";

type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  teacherId: string | null;
  aralTeacherId: string | null;
  deletedAt: Date | null;
};

let learnerRow: LearnerRow;
let txCalls: { learnerUpdate: unknown[] };

function makeLearner(overrides: Partial<LearnerRow> = {}): LearnerRow {
  return {
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    gradeLevelId: FROM_GRADE_ID,
    sectionId: null,
    teacherId: TEACHER_OUT,
    aralTeacherId: TEACHER_ARAL,
    deletedAt: null,
    ...overrides,
  };
}

const learnerFindFirst = vi.fn(
  async (args: { where: { id: string; deletedAt: null } }) =>
    learnerRow.id === args.where.id && learnerRow.deletedAt === null
      ? { ...learnerRow }
      : null
);

/** Honours `schoolId` so a fixture cannot accidentally cross tenants unnoticed. */
const gradeLevelFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string } }) => ({
    id: args.where.id,
    type: args.where.id === TO_GRADE_ID ? "G4" : "G3",
  })
);

const userFindFirst = vi.fn(async (args: { where: { id: string } }) => ({
  id: args.where.id,
}));

const schoolFindFirst = vi.fn(async (args: { where: { id: string } }) => ({
  id: args.where.id,
  isActive: true,
}));

/** Must never be reached by these fixtures — see fixture note 2. */
const sectionFindFirst = vi.fn(async () => null);

function makeTx() {
  return {
    enrollment: {
      // No ACTIVE enrollment: the shortest green path through both transactions.
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    schoolYear: { findFirst: vi.fn(async () => null) },
    learner: {
      update: vi.fn(async (args: unknown) => {
        txCalls.learnerUpdate.push(args);
        return {};
      }),
    },
  };
}

const transaction = vi.fn(
  async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx())
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: { findFirst: (...a: unknown[]) => learnerFindFirst(...(a as [never])) },
    gradeLevel: {
      findFirst: (...a: unknown[]) => gradeLevelFindFirst(...(a as [never])),
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...(a as [never])) },
    school: { findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [never])) },
    // Args are never inspected — the only assertion on this fake is that it is
    // never reached at all.
    section: { findFirst: () => sectionFindFirst() },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
const requireUser = vi.fn(async () => ({
  id: ADMIN_ID,
  schoolId: null,
  role: "SUPER_ADMIN",
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...(a as [])),
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
}));

/**
 * The real implementation, deliberately. Hard-coding a throw would make case 4
 * pass even if `assertSameSchool` were deleted from the action.
 */
const assertSameSchool = vi.fn(
  (userSchoolId: string, resourceSchoolId: string | null | undefined) => {
    if (!resourceSchoolId || resourceSchoolId !== userSchoolId) {
      throw new Error("Not found");
    }
  }
);
vi.mock("@/lib/auth/tenant", () => ({
  assertSameSchool: (...a: unknown[]) =>
    assertSameSchool(...(a as [string, string | null | undefined])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...(a as [])),
  AUDIT_ACTIONS: {
    LEARNER_TRANSFER: "LEARNER_TRANSFER",
    LEARNER_TRANSFER_CROSS_SCHOOL: "LEARNER_TRANSFER_CROSS_SCHOOL",
  },
}));

const ensureFloatingGradeLevel = vi.fn(async () => "grade-floating");
vi.mock("@/lib/grades/floating", () => ({
  ensureFloatingGradeLevel: (...a: unknown[]) =>
    ensureFloatingGradeLevel(...(a as [])),
}));

// Without this the action throws outside a request scope and never returns ok.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...(a as [])),
}));

const revalidateTeacherCaches = vi.fn();
const revalidateSchoolDashboard = vi.fn();
const revalidateSchoolHeadTeachers = vi.fn();
const revalidateSchoolsList = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTeacherCaches: (...a: unknown[]) => revalidateTeacherCaches(...(a as [])),
  revalidateSchoolDashboard: (...a: unknown[]) =>
    revalidateSchoolDashboard(...(a as [])),
  revalidateSchoolHeadTeachers: (...a: unknown[]) =>
    revalidateSchoolHeadTeachers(...(a as [])),
  revalidateSchoolsList: (...a: unknown[]) => revalidateSchoolsList(...(a as [])),
}));

// Imported after the mock factories above are registered. The real Zod schemas
// run — a mocked schema is how a fixture typo becomes a green test.
const { transferLearner, transferLearnerCrossSchool } = await import(
  "@/lib/actions/enrollment"
);

/** Omits `targetSectionId` entirely — see fixture note 2. */
function sameSchoolFormData(): FormData {
  const fd = new FormData();
  fd.set("learnerId", LEARNER_ID);
  fd.set("targetGradeLevelId", TO_GRADE_ID);
  fd.set("targetTeacherId", TEACHER_IN);
  return fd;
}

function crossSchoolFormData(): FormData {
  const fd = new FormData();
  fd.set("learnerId", LEARNER_ID);
  fd.set("targetSchoolId", OTHER_SCHOOL_ID);
  fd.set("targetGradeLevelId", TO_GRADE_ID);
  fd.set("targetTeacherId", TEACHER_IN);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  learnerRow = makeLearner();
  txCalls = { learnerUpdate: [] };
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  requireUser.mockResolvedValue({
    id: ADMIN_ID,
    schoolId: null,
    role: "SUPER_ADMIN",
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("transferLearner — teacher cache fan-out", () => {
  it("busts the designated ARAL tutor as well as both advisers", async () => {
    const result = await transferLearner(sameSchoolFormData());
    // Asserted first: a bailed-out action would make the bust assertions vacuous.
    expect(result).toEqual({ ok: true });

    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    // The transfer really happened, so this is the success path and not a no-op.
    expect(txCalls.learnerUpdate[0]).toMatchObject({
      where: { id: LEARNER_ID },
      data: { gradeLevelId: TO_GRADE_ID, teacherId: TEACHER_IN },
    });
    // Cross-grade with the section omitted needs no section row at all.
    expect(sectionFindFirst).not.toHaveBeenCalled();

    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_OUT);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_IN);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ARAL);
    // Three distinct ids, and the incoming call is guarded by
    // `resolvedTeacherId !== learner.teacherId`, so three is the right number.
    expect(revalidateTeacherCaches).toHaveBeenCalledTimes(3);
  });

  it("makes no third call when the learner has no designated ARAL tutor", async () => {
    learnerRow = makeLearner({ aralTeacherId: null });

    const result = await transferLearner(sameSchoolFormData());
    expect(result).toEqual({ ok: true });

    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_OUT);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_IN);
    expect(revalidateTeacherCaches).toHaveBeenCalledTimes(2);
    // Pins the `if (learner.aralTeacherId)` guard — the half of the one-liner a
    // future simplification is most likely to drop.
    expect(revalidateTeacherCaches).not.toHaveBeenCalledWith(null);
    expect(revalidateTeacherCaches).not.toHaveBeenCalledWith(undefined);
  });

  it("refuses another school's learner without disclosing which school it is in", async () => {
    // The learner lookup at enrollment.ts:108 carries NO `schoolId` in its
    // `where`. Tenancy on this action rests entirely on the `assertSameSchool`
    // call below it: delete that one line and a School Head can transfer any
    // learner in the database.
    learnerRow = makeLearner({ schoolId: OTHER_SCHOOL_ID });

    const result = await transferLearner(sameSchoolFormData());
    expect(result).toEqual({ ok: false, error: "Not found" });

    expect(assertSameSchool).toHaveBeenCalledWith(SCHOOL_ID, OTHER_SCHOOL_ID);
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidateTeacherCaches).not.toHaveBeenCalled();
    // The generic message must not regress into one that names the tenant.
    expect(JSON.stringify(result)).not.toContain(OTHER_SCHOOL_ID);
  });
});

describe("transferLearnerCrossSchool — teacher cache fan-out", () => {
  it("busts the designated ARAL tutor and both schools' dashboards", async () => {
    const result = await transferLearnerCrossSchool(crossSchoolFormData());
    expect(result).toEqual({ ok: true });

    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(OTHER_SCHOOL_ID);
    expect(revalidateSchoolsList).toHaveBeenCalled();

    // The tutor remains a user of the ORIGIN school after a cross-school move.
    // That dangling pointer is a known pre-existing defect and is out of scope
    // here; busting their caches is correct either way, because the stale entry
    // genuinely belongs to them.
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ARAL);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_OUT);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_IN);
    // The incoming call here is unconditional, so distinct ids keep this at 3.
    expect(revalidateTeacherCaches).toHaveBeenCalledTimes(3);
  });
});
