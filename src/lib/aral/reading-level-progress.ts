import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { completeAssessmentWhereForGrades } from "@/lib/reading/policy";

export type MonthlyAssessmentProgress = {
  /** Learners in the filtered set with a complete assessment saved this month. */
  completed: number;
  /** Learners in the filtered set. */
  total: number;
};

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
   * Grades in scope for this progress count. `completeAssessmentWhereForGrades`
   * partitions these by `languagesForGrade`, so a Grade 1/Grade 2 learner's
   * "assessed" no longer requires an English value that grade never collects
   * (docs/reading-policy-spec.md section 4b).
   */
  grades: { id: string; type: string }[];
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
        // `AND`, not a spread merge: `completeAssessmentWhereForGrades` may itself
        // set a `learner` key (to route each row to the right grade's language
        // rule), and merging that into the same object as `learner:
        // args.learnerWhere` would let one silently clobber the other depending
        // on how many grade shapes it produced.
        AND: [completeAssessmentWhereForGrades(args.grades), { learner: args.learnerWhere }],
      },
      select: { learnerId: true },
      // A learner can hold more than one row in a month (a legacy weekly row plus
      // the month anchor); each learner may only be counted once.
      distinct: ["learnerId"],
    }),
  ]);

  return { completed: assessed.length, total };
}
