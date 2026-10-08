import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-school transfer of an ARAL learner. Decision: the ARAL flag
 * (`isAralLearner` / `aralEnrolledAt`) is KEPT and only the origin school's
 * tutor pointer is cleared, because the destination School Head's ARAL page
 * (`src/app/school-head/(app)/aral/page.tsx`) lists every
 * `isAralLearner: true, archivedAt: null` learner of the school and counts the
 * ones with `aralTeacherId: null` as "Awaiting a tutor". This pins both halves:
 * what the action writes, and that the destination's list query matches it.
 */

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const LEARNER_ID = "learner-1";
const TO_GRADE_B = "grade-to-b";
const TEACHER_B = "teacher-b";

const learner = {
  id: LEARNER_ID,
  schoolId: SCHOOL_A,
  gradeLevelId: "grade-from",
  sectionId: null,
  teacherId: "teacher-old",
  aralTeacherId: "tutor-at-a",
  isAralLearner: true,
  deletedAt: null,
  archivedAt: null as Date | null,
};

const learnerUpdate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
function makeTx() {
  return {
    enrollment: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    schoolYear: { findFirst: vi.fn(async () => null) },
    learner: { update: (a: { data: Record<string, unknown> }) => learnerUpdate(a) },
    sectionTransferRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
}
const transaction = vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()));

vi.mock("@/lib/auth/district-scope", () => ({
  requireAdminScope: vi.fn(async () => ({
    user: { id: "sa-1", role: "SUPER_ADMIN", schoolId: null },
    scope: { kind: "division" },
  })),
  loadSchoolInScope: vi.fn(async (_s: unknown, id: string) => ({ id, isActive: true })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: { findFirst: vi.fn(async () => ({ ...learner })) },
    gradeLevel: { findFirst: vi.fn(async () => ({ id: TO_GRADE_B, type: "G4" })) },
    user: { findFirst: vi.fn(async () => ({ id: TEACHER_B })) },
    section: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: vi.fn(async () => ({ id: "head-1", schoolId: SCHOOL_A })),
}));
vi.mock("@/lib/auth/tenant", () => ({ assertSameSchool: vi.fn() }));
vi.mock("@/lib/grades/floating", () => ({
  ensureFloatingGradeLevel: vi.fn(async () => "grade-floating"),
}));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: vi.fn(async () => {}) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTransferRequests: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TESTREF") }));

const { transferLearnerCrossSchool } = await import("@/lib/actions/enrollment");

beforeEach(() => vi.clearAllMocks());

describe("transferLearnerCrossSchool — ARAL learner", () => {
  it("clears the origin tutor but keeps the ARAL flag, so the learner lands in the destination's untutored list", async () => {
    const fd = new FormData();
    fd.set("learnerId", LEARNER_ID);
    fd.set("targetSchoolId", SCHOOL_B);
    fd.set("targetGradeLevelId", TO_GRADE_B);
    fd.set("targetTeacherId", TEACHER_B);

    const res = await transferLearnerCrossSchool(fd);
    expect(res).toMatchObject({ ok: true });

    const data = learnerUpdate.mock.calls[0][0].data;
    expect(data.schoolId).toBe(SCHOOL_B);
    expect(data.aralTeacherId).toBeNull();
    expect(data.archivedAt).toBeNull();
    // Flag untouched: not in the update at all.
    expect(data).not.toHaveProperty("isAralLearner");
    expect(data).not.toHaveProperty("aralEnrolledAt");

    // The row as it stands after the update matches the destination School
    // Head's "Awaiting a tutor" predicate.
    const after = { ...learner, ...data, deletedAt: null };
    expect(after.schoolId).toBe(SCHOOL_B);
    expect(after.deletedAt).toBeNull();
    expect(after.archivedAt).toBeNull();
    expect(after.isAralLearner).toBe(true);
    expect(after.aralTeacherId).toBeNull();
  });

  it("the destination School Head ARAL page still counts untutored ARAL learners by that predicate", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/school-head/(app)/aral/page.tsx"),
      "utf8"
    );
    expect(src).toMatch(/isAralLearner: true/);
    expect(src).toMatch(/archivedAt: null/);
    expect(src).toMatch(/\.\.\.programWhere, aralTeacherId: null/);
  });
});
