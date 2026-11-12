import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * enrollFromMasterlist. The zod schema, action() wrapper and
 * resolveAdvisoryTarget are real; only I/O is faked. Every tx write is logged
 * in order, to prove complete-old, create-new, update-learners, set-based.
 */

const USER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
// The open gate from tests/setup/school-year-gate.ts.
const YEAR_ID = "test-school-year";
const SECTION_ID = "section-5a";
const GRADE_ID = "grade-5";

let log: { op: string; args: unknown }[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      cb({
        enrollment: {
          updateMany: async (args: unknown) => {
            log.push({ op: "enrollment.updateMany", args });
            return { count: 1 };
          },
          createMany: async (args: unknown) => {
            log.push({ op: "enrollment.createMany", args });
            return { count: 2 };
          },
        },
        learner: {
          updateMany: async (args: unknown) => {
            log.push({ op: "learner.updateMany", args });
            return { count: 2 };
          },
        },
      }),
  },
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...a),
}));

let placements: unknown[];
vi.mock("@/lib/teachers/advisory", async () => {
  const real = await vi.importActual<typeof import("@/lib/teachers/advisory")>("@/lib/teachers/advisory");
  return { ...real, getAdvisoryPlacements: vi.fn(async () => placements) };
});

const getMasterlist = vi.fn();
vi.mock("@/lib/learners/masterlist", () => ({
  getMasterlist: (...a: unknown[]) => getMasterlist(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...a: unknown[]) => revalidateLearnerScoped(...a),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));

const gate = await import("@/lib/school-year/gate");
const { AppError } = await import("@/lib/errors/app-error");
const { enrollFromMasterlist } = await import("@/lib/actions/enroll-learner");

const placement = {
  sectionId: SECTION_ID,
  sectionName: "Rizal",
  gradeLevelId: GRADE_ID,
  gradeType: "G5",
  gradeLabel: "Grade 5",
  label: "Grade 5 - Rizal",
};

const entry = (learnerId: string) => ({
  learnerId,
  name: learnerId,
  gender: "FEMALE",
  fromGradeLabel: "Grade 4",
  fromSectionName: "Mabini",
  outcome: "PROMOTED",
  fromYearLabel: "2025-2026",
});

beforeEach(() => {
  vi.clearAllMocks();
  log = [];
  placements = [placement];
  requireSchoolUser.mockResolvedValue({ id: USER_ID, schoolId: SCHOOL_ID, role: "TEACHER" });
  getMasterlist.mockImplementation(async ({ learnerIds }: { learnerIds: string[] }) => learnerIds.map(entry));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("enrollFromMasterlist", () => {
  it("completes the old enrollment, creates the new one, then moves the learner", async () => {
    const res = await enrollFromMasterlist({ sectionId: SECTION_ID, learnerIds: ["l1", "l2"] });
    expect(res).toEqual({ ok: true, enrolled: 2 });
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
    expect(log.map((l) => l.op)).toEqual([
      "enrollment.updateMany",
      "enrollment.createMany",
      "learner.updateMany",
    ]);
    expect(log[0].args).toEqual({
      where: { learnerId: { in: ["l1", "l2"] }, status: "ACTIVE", schoolYearId: { not: YEAR_ID } },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    const row = (learnerId: string) => ({
      learnerId,
      schoolId: SCHOOL_ID,
      schoolYearId: YEAR_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      teacherId: USER_ID,
      status: "ACTIVE",
    });
    expect(log[1].args).toEqual({ data: [row("l1"), row("l2")] });
    expect(log[2].args).toEqual({
      where: { id: { in: ["l1", "l2"] }, schoolId: SCHOOL_ID },
      data: { gradeLevelId: GRADE_ID, sectionId: SECTION_ID, teacherId: USER_ID },
    });
    expect(revalidateLearnerScoped).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_ID, teacherId: USER_ID })
    );
  });

  it("reads the masterlist for this school, the active year and the advisory's grade", async () => {
    await enrollFromMasterlist({ sectionId: SECTION_ID, learnerIds: ["l1"] });
    expect(getMasterlist).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: SCHOOL_ID,
        activeSchoolYearId: YEAR_ID,
        targetGradeType: "G5",
        learnerIds: ["l1"],
      })
    );
  });

  it("refuses a learner who is not on the masterlist and writes nothing", async () => {
    getMasterlist.mockResolvedValueOnce([entry("l1")]);
    const res = await enrollFromMasterlist({ sectionId: SECTION_ID, learnerIds: ["l1", "other-school-learner"] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(log).toEqual([]);
  });

  it("refuses a section the teacher does not advise", async () => {
    const res = await enrollFromMasterlist({ sectionId: "someone-elses", learnerIds: ["l1"] });
    expect(res).toMatchObject({ ok: false });
    expect(getMasterlist).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("refuses when the school year is closed", async () => {
    vi.mocked(gate.assertSchoolYearOpen).mockRejectedValueOnce(new AppError("SCHOOL_YEAR_CLOSED"));
    const res = await enrollFromMasterlist({ sectionId: SECTION_ID, learnerIds: ["l1"] });
    expect(res).toMatchObject({ ok: false, code: "SCHOOL_YEAR_CLOSED" });
    expect(log).toEqual([]);
  });

  it("rejects an empty selection", async () => {
    const res = await enrollFromMasterlist({ sectionId: SECTION_ID, learnerIds: [] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(log).toEqual([]);
  });
});
