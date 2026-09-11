import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `countMonthlyAssessmentProgress` and the shared `COMPLETE_ASSESSMENT_WHERE`
 * fragment it (and the two dashboard aggregates) use to decide whether a
 * `ReadingLevelRecord` counts as a completed monthly assessment.
 *
 * `englishProfile`/`filipinoProfile` are nullable now, so a row can be saved
 * with only some fields set. This suite pins the rule that only a row with
 * all four required scales set — both profiles and both level columns —
 * counts as "assessed".
 */

type FakeRecord = {
  id: string;
  learnerId: string;
  weekStart: Date;
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
};

let records: FakeRecord[] = [];

const findMany = vi.fn(
  async (args: {
    where: {
      weekStart?: { gte?: Date; lt?: Date };
      englishProfile?: { not: null };
      filipinoProfile?: { not: null };
      wordRecognitionLevel?: { not: null };
      readingComprehensionLevel?: { not: null };
      learner?: unknown;
    };
    distinct?: string[];
  }) => {
    const { gte, lt } = args.where.weekStart ?? {};
    let rows = records.filter((r) => {
      if (gte && r.weekStart.getTime() < gte.getTime()) return false;
      if (lt && r.weekStart.getTime() >= lt.getTime()) return false;
      if (args.where.englishProfile && r.englishProfile === null) return false;
      if (args.where.filipinoProfile && r.filipinoProfile === null) return false;
      if (args.where.wordRecognitionLevel && r.wordRecognitionLevel === null) return false;
      if (args.where.readingComprehensionLevel && r.readingComprehensionLevel === null)
        return false;
      return true;
    });

    if (args.distinct?.includes("learnerId")) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        if (seen.has(r.learnerId)) return false;
        seen.add(r.learnerId);
        return true;
      });
    }

    return rows.map((r) => ({ learnerId: r.learnerId }));
  }
);

const learnerCount = vi.fn(async () => 5);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { count: () => learnerCount() },
    readingLevelRecord: {
      findMany: (...a: unknown[]) => findMany(...(a as [never])),
    },
  },
}));

const { countMonthlyAssessmentProgress, COMPLETE_ASSESSMENT_WHERE } = await import(
  "@/lib/aral/reading-level-progress"
);

const MONTH_START = new Date(2026, 7, 1); // Aug 2026
const MONTH_END = new Date(2026, 8, 1);

beforeEach(() => {
  vi.clearAllMocks();
  records = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("COMPLETE_ASSESSMENT_WHERE", () => {
  it("carries all four required not-null keys", () => {
    expect(COMPLETE_ASSESSMENT_WHERE).toEqual({
      englishProfile: { not: null },
      filipinoProfile: { not: null },
      wordRecognitionLevel: { not: null },
      readingComprehensionLevel: { not: null },
    });
  });
});

describe("countMonthlyAssessmentProgress", () => {
  it("does not count a row with both profiles null", async () => {
    records = [
      {
        id: "r1",
        learnerId: "l1",
        weekStart: new Date(2026, 7, 1),
        englishProfile: null,
        filipinoProfile: null,
        wordRecognitionLevel: "INDEPENDENT",
        readingComprehensionLevel: "INDEPENDENT",
      },
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
    });

    expect(result.completed).toBe(0);
  });

  it("does not count a row with profiles set but wordRecognitionLevel null", async () => {
    records = [
      {
        id: "r1",
        learnerId: "l1",
        weekStart: new Date(2026, 7, 1),
        englishProfile: "FRUSTRATION",
        filipinoProfile: "FRUSTRATION",
        wordRecognitionLevel: null,
        readingComprehensionLevel: "INDEPENDENT",
      },
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
    });

    expect(result.completed).toBe(0);
  });

  it("counts a legacy Monday-keyed row inside the month range", async () => {
    // 10 Aug 2026 is a Monday, not the 1st — models a row from the retired
    // weekly grid that still falls inside this month's [gte, lt) window.
    records = [
      {
        id: "r1",
        learnerId: "l1",
        weekStart: new Date(2026, 7, 10),
        englishProfile: "FRUSTRATION",
        filipinoProfile: "FRUSTRATION",
        wordRecognitionLevel: "INDEPENDENT",
        readingComprehensionLevel: "INDEPENDENT",
      },
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
    });

    expect(result.completed).toBe(1);
  });

  it("dedupes a learner holding two complete records in one month", async () => {
    records = [
      {
        id: "r1",
        learnerId: "l1",
        weekStart: new Date(2026, 7, 3),
        englishProfile: "FRUSTRATION",
        filipinoProfile: "FRUSTRATION",
        wordRecognitionLevel: "INDEPENDENT",
        readingComprehensionLevel: "INDEPENDENT",
      },
      {
        id: "r2",
        learnerId: "l1",
        weekStart: new Date(2026, 7, 17),
        englishProfile: "FRUSTRATION",
        filipinoProfile: "FRUSTRATION",
        wordRecognitionLevel: "INDEPENDENT",
        readingComprehensionLevel: "INDEPENDENT",
      },
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
    });

    expect(result.completed).toBe(1);
  });

  it("passes a where clause carrying all four completeness keys to Prisma", async () => {
    await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.englishProfile).toEqual({ not: null });
    expect(where.filipinoProfile).toEqual({ not: null });
    expect(where.wordRecognitionLevel).toEqual({ not: null });
    expect(where.readingComprehensionLevel).toEqual({ not: null });
  });
});
