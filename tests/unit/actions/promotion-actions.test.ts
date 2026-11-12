import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * savePromotionOutcomes. The zod schema, action() wrapper and
 * resolveAdvisoryTarget are real; only I/O is faked. Writes are reachable only
 * through `tx`, so a write outside the transaction throws and fails the case.
 */

const USER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const YEAR_ID = "year-1";
const SECTION_ID = "section-5a";

const enrollmentFindMany = vi.fn();
const txUpdateMany = vi.fn(async (..._a: unknown[]) => ({ count: 1 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enrollment: { findMany: (...a: unknown[]) => enrollmentFindMany(...a) },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ enrollment: { updateMany: (...a: unknown[]) => txUpdateMany(...a) } }),
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

vi.mock("@/lib/learners/masterlist", () => ({ getPromotionRoster: vi.fn(async () => []) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...a: unknown[]) => revalidateLearnerScoped(...a),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));

const gate = await import("@/lib/school-year/gate");
const { AppError } = await import("@/lib/errors/app-error");
const { savePromotionOutcomes } = await import("@/lib/actions/promotion");

const LAST_MONTH = {
  open: true,
  reason: null,
  isLastMonth: true,
  schoolYearId: YEAR_ID,
  label: "2026-2027",
  activeStart: "2026-06-01",
  activeEnd: "2027-04-30",
};

const placement = {
  sectionId: SECTION_ID,
  sectionName: "Rizal",
  gradeLevelId: "grade-5",
  gradeType: "G5",
  gradeLabel: "Grade 5",
  label: "Grade 5 - Rizal",
};

const input = {
  sectionId: SECTION_ID,
  outcomes: [
    { learnerId: "l1", outcome: "PROMOTED" as const },
    { learnerId: "l2", outcome: "RETAINED" as const },
    { learnerId: "l3", outcome: "PROMOTED" as const },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  placements = [placement];
  requireSchoolUser.mockResolvedValue({ id: USER_ID, schoolId: SCHOOL_ID, role: "TEACHER" });
  vi.mocked(gate.assertSchoolYearOpen).mockResolvedValue(LAST_MONTH as never);
  enrollmentFindMany.mockResolvedValue([
    { id: "e1", learnerId: "l1" },
    { id: "e2", learnerId: "l2" },
    { id: "e3", learnerId: "l3" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("savePromotionOutcomes", () => {
  it("saves each outcome on the learners' active enrollments", async () => {
    const res = await savePromotionOutcomes(input);
    expect(res).toEqual({ ok: true, promoted: 2, retained: 1 });
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
    expect(enrollmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: SCHOOL_ID,
          schoolYearId: YEAR_ID,
          sectionId: SECTION_ID,
          status: "ACTIVE",
        }),
      })
    );
    expect(txUpdateMany).toHaveBeenCalledTimes(2);
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["e1", "e3"] } },
      data: expect.objectContaining({ outcome: "PROMOTED", outcomeById: USER_ID }),
    });
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["e2"] } },
      data: expect.objectContaining({ outcome: "RETAINED", outcomeById: USER_ID }),
    });
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({ schoolId: SCHOOL_ID, teacherId: USER_ID });
  });

  it("refuses outside the last month and writes nothing", async () => {
    vi.mocked(gate.assertSchoolYearOpen).mockResolvedValueOnce({ ...LAST_MONTH, isLastMonth: false } as never);
    const res = await savePromotionOutcomes(input);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { error: string }).error).toMatch(/last month/i);
    expect(enrollmentFindMany).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses when the school year is closed", async () => {
    vi.mocked(gate.assertSchoolYearOpen).mockRejectedValueOnce(new AppError("SCHOOL_YEAR_CLOSED"));
    const res = await savePromotionOutcomes(input);
    expect(res).toMatchObject({ ok: false, code: "SCHOOL_YEAR_CLOSED" });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a section the teacher does not advise", async () => {
    const res = await savePromotionOutcomes({ ...input, sectionId: "someone-elses" });
    expect(res).toMatchObject({ ok: false });
    expect(enrollmentFindMany).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses when a learner is not active in this advisory", async () => {
    enrollmentFindMany.mockResolvedValueOnce([
      { id: "e1", learnerId: "l1" },
      { id: "e2", learnerId: "l2" },
    ]);
    const res = await savePromotionOutcomes(input);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an empty list", async () => {
    const res = await savePromotionOutcomes({ sectionId: SECTION_ID, outcomes: [] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(txUpdateMany).not.toHaveBeenCalled();
  });
});
