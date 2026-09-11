import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type MonthlyAssessmentProgress = {
  /** Learners in the filtered set with a complete assessment saved this month. */
  completed: number;
  /** Learners in the filtered set. */
  total: number;
};

/**
 * Completeness predicate for a `ReadingLevelRecord`, shared by every "assessed"
 * counter (the monthly grid progress bar, the admin dashboard aggregate, and the
 * teacher overview). Mirrors `isRowComplete` in the monthly grid: all four
 * required scales set. `englishProfile` and `filipinoProfile` became nullable so
 * a partially-filled row can be saved — a row existing no longer implies either
 * is set, so both must be checked explicitly alongside the two level columns.
 * `writingLevel` and `notes` are excluded on purpose: both are nullable in the
 * schema and optional in the grid, so they are not part of what "assessed"
 * means. Define this once so the three call sites cannot drift.
 */
export const COMPLETE_ASSESSMENT_WHERE = {
  englishProfile: { not: null },
  filipinoProfile: { not: null },
  wordRecognitionLevel: { not: null },
  readingComprehensionLevel: { not: null },
} satisfies Prisma.ReadingLevelRecordWhereInput;

/**
 * Grade-wide monthly assessment progress for one filtered learner set.
 *
 * Lives here rather than in the page or the fetch action because both need the
 * number and they must agree: the page renders it on the server, and
 * `fetchAralReadingLevelForMonth` returns it again when the teacher steps to
 * another month without a full navigation. Two implementations of "assessed"
 * would eventually disagree and the bar would jump on navigation.
 *
 * The window is a range, not an equality on the month anchor, for the same
 * reason the fetch reads a range: rows written by the earlier weekly grid sit on
 * arbitrary Mondays inside the month and still count as that month's assessment.
 */
export async function countMonthlyAssessmentProgress(args: {
  learnerWhere: Prisma.LearnerWhereInput;
  monthStart: Date;
  monthEnd: Date;
  /**
   * The filtered learner count, when the caller already has it. The page needs
   * the same number to size its pager, and counting it twice against identical
   * `where` input is a wasted round trip; the fetch action has no such count and
   * omits this.
   */
  total?: number;
}): Promise<MonthlyAssessmentProgress> {
  const [total, assessed] = await Promise.all([
    args.total ?? prisma.learner.count({ where: args.learnerWhere }),
    prisma.readingLevelRecord.findMany({
      where: {
        weekStart: { gte: args.monthStart, lt: args.monthEnd },
        ...COMPLETE_ASSESSMENT_WHERE,
        learner: args.learnerWhere,
      },
      select: { learnerId: true },
      // A learner can hold more than one row in a month (a legacy weekly row plus
      // the month anchor); each learner may only be counted once.
      distinct: ["learnerId"],
    }),
  ]);

  return { completed: assessed.length, total };
}
