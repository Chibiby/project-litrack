import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fetchAralReadingLevelForMonth` reads `ReadingLevelRecord.englishProfile` /
 * `filipinoProfile`, which became nullable so a teacher can save a partially
 * filled monthly assessment. A null profile must round-trip through the fetch
 * untouched — no throw, no filtering the row out, no coercion — because a
 * partial assessment is real data the grid needs to prefill.
 */

const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const GRADE_ID = "grade-g3";

const gradeLevelFindFirst = vi.fn();
const readingLevelRecordFindMany = vi.fn();
const learnerCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gradeLevel: { findFirst: (...args: unknown[]) => gradeLevelFindFirst(...(args as [])) },
    readingLevelRecord: {
      findMany: (...args: unknown[]) => readingLevelRecordFindMany(...(args as [])),
    },
    learner: { count: (...args: unknown[]) => learnerCount(...(args as [])) },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

const { fetchAralReadingLevelForMonth } = await import(
  "@/lib/actions/aral-grid"
);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({
    id: TEACHER_ID,
    role: "TEACHER",
    schoolId: SCHOOL_ID,
  });
  gradeLevelFindFirst.mockResolvedValue({ id: GRADE_ID });
  learnerCount.mockResolvedValue(1);
  readingLevelRecordFindMany.mockImplementation(
    async (args: { where: Record<string, unknown> }) => {
      // `countMonthlyAssessmentProgress`'s call names the completeness filter;
      // the fetch's own call does not. Distinguish them the way the two
      // call sites actually differ, rather than relying on call order.
      if ("englishProfile" in args.where) return [];
      return [
        {
          learnerId: "learner-1",
          englishProfile: null,
          filipinoProfile: "INSTRUCTIONAL_DEVELOPING",
          wordRecognitionLevel: null,
          readingComprehensionLevel: null,
          writingLevel: null,
          notes: null,
        },
      ];
    }
  );
});

describe("fetchAralReadingLevelForMonth — null profile", () => {
  it("passes a partially-assessed row through without throwing", async () => {
    const res = await fetchAralReadingLevelForMonth({
      gradeId: GRADE_ID,
      monthKey: "2026-08-01",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.records).toHaveLength(1);
    const [record] = res.data.records;
    expect(record.learnerId).toBe("learner-1");
    expect(record.englishProfile).toBeNull();
    expect(record.filipinoProfile).toBe("INSTRUCTIONAL_DEVELOPING");
  });
});
