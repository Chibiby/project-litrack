import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `countMonthlyAssessmentProgress`, and the `completeAssessmentWhereForGrades`
 * predicate (`src/lib/reading/policy.ts`) it now takes a `grades` argument to
 * build, for deciding whether a `ReadingLevelRecord` counts as a completed
 * monthly assessment.
 *
 * `COMPLETE_ASSESSMENT_WHERE` — a STATIC where-fragment — is gone
 * (docs/reading-policy-spec.md section 4b): a static "English required"
 * fragment would make every Grade 1/Grade 2 ARAL learner permanently
 * "incomplete" the moment English collection stops for those grades, since
 * English can never be recorded for them again. `countMonthlyAssessmentProgress`
 * now takes the grades in scope and routes each one through its own language
 * policy.
 */

type FakeRecord = {
  id: string;
  learnerId: string;
  weekStart: Date;
  gradeLevelId: string;
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
};

let records: FakeRecord[] = [];

/**
 * Generic evaluator for the `where` shape `completeAssessmentWhereForGrades`
 * (composed under `AND` with `{ learner: args.learnerWhere }` by
 * `countMonthlyAssessmentProgress`) can produce: `AND`/`OR` combinators, a
 * `weekStart` range, a `learner.gradeLevelId.in` filter, and `{ not: null }`
 * field checks. Real enough to prove the production code builds the shape
 * this suite pins, without re-implementing Prisma.
 */
function matchesWhere(record: FakeRecord, where: Record<string, unknown>): boolean {
  for (const key of Object.keys(where)) {
    const cond = where[key];
    if (key === "AND") {
      if (!(cond as Record<string, unknown>[]).every((c) => matchesWhere(record, c))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((c) => matchesWhere(record, c))) return false;
      continue;
    }
    if (key === "weekStart") {
      const { gte, lt } = cond as { gte?: Date; lt?: Date };
      if (gte && record.weekStart.getTime() < gte.getTime()) return false;
      if (lt && record.weekStart.getTime() >= lt.getTime()) return false;
      continue;
    }
    if (key === "learner") {
      const learnerWhere = cond as { gradeLevelId?: { in: string[] } };
      if (learnerWhere.gradeLevelId && !learnerWhere.gradeLevelId.in.includes(record.gradeLevelId)) {
        return false;
      }
      continue;
    }
    if (key === "id") {
      // `completeAssessmentWhereForGrades([])` returns `{ id: "" }` to match
      // nothing rather than everything — no fake record ever has id "".
      if (record.id !== cond) return false;
      continue;
    }
    if (cond && typeof cond === "object" && "not" in (cond as Record<string, unknown>)) {
      if ((cond as { not: null }).not === null && (record as Record<string, unknown>)[key] == null) {
        return false;
      }
      continue;
    }
  }
  return true;
}

const findMany = vi.fn(
  async (args: { where: Record<string, unknown>; distinct?: string[] }) => {
    let rows = records.filter((r) => matchesWhere(r, args.where));

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

const { countMonthlyAssessmentProgress } = await import(
  "@/lib/aral/reading-level-progress"
);

const MONTH_START = new Date(2026, 7, 1); // Aug 2026
const MONTH_END = new Date(2026, 8, 1);

/** A standard grade: both languages, the original four values (docs/reading-policy-spec.md). */
const G5_GRADE = { id: "grade-g5", type: "G5" };
/** Filipino-only, now that Grade 1/Grade 2 stop collecting English. */
const G1_GRADE = { id: "grade-g1", type: "G1" };
const KINDER_GRADE = { id: "grade-kinder", type: "KINDER" };

function record(over: Partial<FakeRecord> = {}): FakeRecord {
  return {
    id: "r1",
    learnerId: "l1",
    weekStart: new Date(2026, 7, 1),
    gradeLevelId: G5_GRADE.id,
    englishProfile: "INDEPENDENT_GRADE_READY",
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_5",
    readingComprehensionLevel: "LEVEL_3",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  records = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("countMonthlyAssessmentProgress — a single standard (both-language) grade", () => {
  it("does not count a row with both profiles null", async () => {
    records = [record({ englishProfile: null, filipinoProfile: null })];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    expect(result.completed).toBe(0);
  });

  it("does not count a row with profiles set but wordRecognitionLevel null", async () => {
    records = [record({ wordRecognitionLevel: null })];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    expect(result.completed).toBe(0);
  });

  it("counts a legacy Monday-keyed row inside the month range", async () => {
    // 10 Aug 2026 is a Monday, not the 1st — models a row from the retired
    // weekly grid that still falls inside this month's [gte, lt) window.
    records = [record({ weekStart: new Date(2026, 7, 10) })];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    expect(result.completed).toBe(1);
  });

  it("dedupes a learner holding two complete records in one month", async () => {
    records = [
      record({ id: "r1", weekStart: new Date(2026, 7, 3) }),
      record({ id: "r2", weekStart: new Date(2026, 7, 17) }),
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    expect(result.completed).toBe(1);
  });

  it("passes a where clause carrying all four completeness keys to Prisma for an all-standard grade set", async () => {
    await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    const where = findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] };
    // No OR for a single standard grade — it collapses to one AND shape
    // (docs/reading-policy-spec.md section 7, the G3-G10 regression fence).
    const shape = where.AND[0];
    expect(shape).not.toHaveProperty("OR");
    expect(shape.englishProfile).toEqual({ not: null });
    expect(shape.filipinoProfile).toEqual({ not: null });
    expect(shape.wordRecognitionLevel).toEqual({ not: null });
    expect(shape.readingComprehensionLevel).toEqual({ not: null });
  });
});

describe("countMonthlyAssessmentProgress — grade-aware completeness (docs/reading-policy-spec.md section 4b)", () => {
  it("counts a Grade 1 ARAL learner complete with Filipino + word + comprehension and NO English", async () => {
    records = [
      record({
        gradeLevelId: G1_GRADE.id,
        englishProfile: null,
      }),
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G1_GRADE],
    });

    expect(result.completed).toBe(1);
  });

  it("does NOT count the equivalent Grade 5 learner with the same three fields and no English", async () => {
    records = [
      record({
        gradeLevelId: G5_GRADE.id,
        englishProfile: null,
      }),
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G5_GRADE],
    });

    expect(result.completed).toBe(0);
  });

  it("counts both grades correctly in one mixed-grade call (a teacher advising Kinder and ARAL-tutoring Grade 5)", async () => {
    records = [
      // Complete for Kinder: no English still required there (Kinder collects
      // both languages), so this one is NOT complete without English.
      record({ id: "r-kinder", learnerId: "l-kinder", gradeLevelId: KINDER_GRADE.id, englishProfile: null }),
      // Complete for Grade 1: English rightly not required.
      record({ id: "r-g1", learnerId: "l-g1", gradeLevelId: G1_GRADE.id, englishProfile: null }),
      // Complete for Grade 5: both languages present.
      record({ id: "r-g5", learnerId: "l-g5", gradeLevelId: G5_GRADE.id }),
    ];

    const result = await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [KINDER_GRADE, G1_GRADE, G5_GRADE],
    });

    // Kinder row excluded (missing required English), Grade 1 and Grade 5
    // rows both count.
    expect(result.completed).toBe(2);
  });

  it("builds an OR of a Filipino-only shape and a both-language shape for a Grade 1 + Grade 5 set", async () => {
    await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [G1_GRADE, G5_GRADE],
    });

    const where = findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] };
    const shape = where.AND[0] as { OR: Record<string, unknown>[] };
    expect(shape.OR).toHaveLength(2);
    const filipinoOnly = shape.OR.find(
      (s) => !("englishProfile" in s)
    ) as Record<string, unknown>;
    const both = shape.OR.find((s) => "englishProfile" in s) as Record<string, unknown>;
    expect(filipinoOnly).toBeDefined();
    expect(both).toBeDefined();
    expect((filipinoOnly.learner as { gradeLevelId: { in: string[] } }).gradeLevelId.in).toEqual([
      G1_GRADE.id,
    ]);
    expect((both.learner as { gradeLevelId: { in: string[] } }).gradeLevelId.in).toEqual([
      G5_GRADE.id,
    ]);
  });

  it("collapses a Kinder + Grade 5 set to a single AND, not an OR — Kinder collects both languages too", async () => {
    // Only Grade 1/Grade 2 are Filipino-only. Kinder still requires English,
    // so a Kinder+G5 set never needs the OR branch at all — conflating "early
    // rubric grade" with "English-excluded grade" would break this.
    await countMonthlyAssessmentProgress({
      learnerWhere: {},
      monthStart: MONTH_START,
      monthEnd: MONTH_END,
      grades: [KINDER_GRADE, G5_GRADE],
    });

    const where = findMany.mock.calls[0][0].where as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).not.toHaveProperty("OR");
  });
});
