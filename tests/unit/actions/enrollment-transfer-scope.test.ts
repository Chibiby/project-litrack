import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `transferLearnerCrossSchool` scope story (docs/specs/district-admin.md I12,
 * T7): a district admin may move a learner only between two schools BOTH
 * inside their assigned districts. `requireUser("SUPER_ADMIN")` was replaced
 * with `requireAdminScope()`, so this file exercises the two independent
 * checks that guard it:
 *
 *  - the SOURCE school: the learner is loaded with
 *    `school: schoolWhereForScope(scope)` actually inside the `where` — the
 *    real, unmocked `schoolWhereForScope` (`src/lib/auth/admin-scope.ts`) is
 *    imported here and fed straight into `learnerFindFirst`'s fake, which
 *    applies it against a fixture school the way a real join would. Deleting
 *    that clause from the action makes the fake's `where.school` argument
 *    `undefined`, which the fake treats as "no filter" — an out-of-scope
 *    learner would then be returned and this test would go red.
 *  - the DESTINATION school: `loadSchoolInScope` (mocked) enforces the scope
 *    itself, the same as in `district-school-management.test.ts`.
 *
 * For the Super Admin (division scope) both checks pass for every live
 * school, so the existing cross-school behaviour is unchanged.
 */

// Real, pure — this is what the learner-lookup fake below is testing the
// action's use of.
import { schoolWhereForScope } from "@/lib/auth/admin-scope";
import { resourceNotFound as resourceNotFoundReal } from "@/lib/errors/app-error";
import type { Prisma } from "@prisma/client";

const DA_ID = "da-1";
const SA_ID = "sa-1";

type SchoolFixture = { id: string; district: string; isDemo: boolean; deletedAt: null; isActive: boolean };
const SCHOOL_A: SchoolFixture = { id: "school-a", district: "Alabel 1", isDemo: false, deletedAt: null, isActive: true };
const SCHOOL_B: SchoolFixture = { id: "school-b", district: "Alabel 2", isDemo: false, deletedAt: null, isActive: true };
const SCHOOL_G: SchoolFixture = { id: "school-g", district: "Glan 1", isDemo: false, deletedAt: null, isActive: true };
const SCHOOLS: Record<string, SchoolFixture> = {
  [SCHOOL_A.id]: SCHOOL_A,
  [SCHOOL_B.id]: SCHOOL_B,
  [SCHOOL_G.id]: SCHOOL_G,
};

const LEARNER_ID = "learner-1";
const FROM_GRADE = "grade-from";
const TO_GRADE_B = "grade-to-b";
const TEACHER_B = "teacher-b";

type LearnerFixture = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  teacherId: string | null;
  aralTeacherId: string | null;
  deletedAt: null;
};
let learner: LearnerFixture = {
  id: LEARNER_ID,
  schoolId: SCHOOL_A.id,
  gradeLevelId: FROM_GRADE,
  sectionId: null,
  teacherId: "teacher-old",
  aralTeacherId: null,
  deletedAt: null,
};

/** Applies a Prisma-shaped `School` where clause against one fixture school. */
function schoolMatches(school: SchoolFixture, where: Prisma.SchoolWhereInput | undefined): boolean {
  if (!where) return true; // no filter at all — see the scope-removed scenario above
  if (where.deletedAt !== undefined && school.deletedAt !== where.deletedAt) return false;
  if ("isDemo" in where && where.isDemo !== undefined && school.isDemo !== where.isDemo) return false;
  const districtFilter = where.district;
  if (
    districtFilter &&
    typeof districtFilter === "object" &&
    "in" in districtFilter &&
    Array.isArray(districtFilter.in)
  ) {
    if (!districtFilter.in.includes(school.district)) return false;
  }
  return true;
}

const learnerFindFirst = vi.fn(
  async (args: { where: { id: string; deletedAt: null; school?: Prisma.SchoolWhereInput } }) => {
    if (args.where.id !== learner.id || learner.deletedAt !== null) return null;
    const school = SCHOOLS[learner.schoolId];
    if (!school || !schoolMatches(school, args.where.school)) return null;
    return { ...learner };
  }
);

type Scope = { kind: "division" } | { kind: "districts"; districts: readonly string[] };

const loadSchoolInScope = vi.fn(async (scope: Scope, schoolId: string, _select?: unknown) => {
  const school = SCHOOLS[schoolId];
  const inScope =
    school !== undefined &&
    (scope.kind === "division" ? true : scope.districts.includes(school.district));
  if (!inScope) {
    throw resourceNotFoundReal("School", { crossTenant: true });
  }
  return { id: school.id, isActive: school.isActive };
});

let scope: Scope = { kind: "districts", districts: ["Alabel 1", "Alabel 2"] };
let actor: { id: string; role: "SUPER_ADMIN" | "DISTRICT_ADMIN"; schoolId: null } = {
  id: DA_ID,
  role: "DISTRICT_ADMIN",
  schoolId: null,
};
const requireAdminScope = vi.fn(async () => ({ user: actor, scope }));

vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: (...a: unknown[]) => requireAdminScope(...(a as [])),
  loadSchoolInScope: (...a: unknown[]) => loadSchoolInScope(...(a as [Scope, string, unknown])),
}));

const gradeLevelFindFirst = vi.fn(async (args: { where: { id: string; schoolId: string } }) => {
  if (args.where.id === TO_GRADE_B && args.where.schoolId === SCHOOL_B.id) {
    return { id: TO_GRADE_B, type: "G4" };
  }
  return null;
});

const userFindFirst = vi.fn(async (args: { where: { id: string; schoolId: string } }) => {
  if (args.where.id === TEACHER_B && args.where.schoolId === SCHOOL_B.id) {
    return { id: TEACHER_B };
  }
  return null;
});

function makeTx() {
  return {
    enrollment: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    schoolYear: { findFirst: vi.fn(async () => null) },
    learner: { update: vi.fn(async () => ({})) },
  };
}
const transaction = vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: { findFirst: (...a: unknown[]) => learnerFindFirst(...(a as [never])) },
    gradeLevel: { findFirst: (...a: unknown[]) => gradeLevelFindFirst(...(a as [never])) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...(a as [never])) },
    section: { findFirst: vi.fn(async () => null) },
  },
}));

// `transferLearner` (same-school, untouched by this slice) still imports
// these; stub them so the module loads without needing a School Head fixture.
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: vi.fn(async () => ({ id: "head-1", schoolId: SCHOOL_A.id })),
}));
vi.mock("@/lib/auth/tenant", () => ({
  assertSameSchool: vi.fn(),
}));
vi.mock("@/lib/grades/floating", () => ({
  ensureFloatingGradeLevel: vi.fn(async () => "grade-floating"),
}));

const writeAudit = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    AUDIT_ACTIONS: actual.AUDIT_ACTIONS,
    writeAudit: (e: Record<string, unknown>) => writeAudit(e),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));
const reportError = vi.fn(() => "E-TESTREF");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...(a as [])) }));

const { transferLearnerCrossSchool } = await import("@/lib/actions/enrollment");

function crossForm(targetSchoolId: string, targetGradeLevelId = TO_GRADE_B, targetTeacherId = TEACHER_B): FormData {
  const fd = new FormData();
  fd.set("learnerId", LEARNER_ID);
  fd.set("targetSchoolId", targetSchoolId);
  fd.set("targetGradeLevelId", targetGradeLevelId);
  fd.set("targetTeacherId", targetTeacherId);
  return fd;
}

function noWritesHappened() {
  expect(transaction).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  learner = {
    id: LEARNER_ID,
    schoolId: SCHOOL_A.id,
    gradeLevelId: FROM_GRADE,
    sectionId: null,
    teacherId: "teacher-old",
    aralTeacherId: null,
    deletedAt: null,
  };
  scope = { kind: "districts", districts: ["Alabel 1", "Alabel 2"] };
  actor = { id: DA_ID, role: "DISTRICT_ADMIN", schoolId: null };
  requireAdminScope.mockImplementation(async () => ({ user: actor, scope }));
});

describe("transferLearnerCrossSchool — district admin scope (I12, T7)", () => {
  it("refuses when the SOURCE school is out of scope: NOT_FOUND, nothing written", async () => {
    learner = { ...learner, schoolId: SCHOOL_G.id };

    const res = await transferLearnerCrossSchool(crossForm(SCHOOL_A.id));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // Proves the learner lookup really carried the scope: the real
    // `schoolWhereForScope` for this scope excludes Glan 1.
    expect(learnerFindFirst.mock.calls[0][0].where.school).toEqual(schoolWhereForScope(scope));
    noWritesHappened();
  });

  it("refuses when the DESTINATION school is out of scope: NOT_FOUND, nothing written", async () => {
    // Source (school-a, Alabel 1) is in scope; only the destination is not.
    const res = await transferLearnerCrossSchool(crossForm(SCHOOL_G.id, TO_GRADE_B, TEACHER_B));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(loadSchoolInScope).toHaveBeenCalledWith(scope, SCHOOL_G.id, expect.anything());
    noWritesHappened();
  });

  it("allows a transfer when both schools are in scope (Alabel 1 to Alabel 2)", async () => {
    const res = await transferLearnerCrossSchool(crossForm(SCHOOL_B.id));

    expect(res).toMatchObject({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: DA_ID,
      schoolId: SCHOOL_B.id,
      action: "LEARNER_TRANSFER_CROSS_SCHOOL",
      metadata: expect.objectContaining({ actorRole: "DISTRICT_ADMIN" }),
    });
  });
});

describe("transferLearnerCrossSchool — Super Admin (division scope) is unchanged", () => {
  beforeEach(() => {
    scope = { kind: "division" };
    actor = { id: SA_ID, role: "SUPER_ADMIN", schoolId: null };
    // Cross-district for a Super Admin: source in Glan 1, destination in Alabel 2.
    learner = { ...learner, schoolId: SCHOOL_G.id };
  });

  it("moves a learner across districts freely", async () => {
    const res = await transferLearnerCrossSchool(crossForm(SCHOOL_B.id));

    expect(res).toMatchObject({ ok: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).not.toHaveProperty("actorRole");
  });
});
