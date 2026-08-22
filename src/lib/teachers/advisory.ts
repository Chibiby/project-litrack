import "server-only";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

/**
 * Where a teacher's new learners go: the section they advise, plus the grade that
 * section sits in.
 *
 * `gradeLevelId` is DERIVED from the section and never stored on the teacher —
 * see `User.advisorySectionId`, which is `@unique`, so there is at most one of
 * these per teacher.
 */
export type AdvisoryPlacement = {
  sectionId: string;
  sectionName: string;
  gradeLevelId: string;
  /** Raw `GradeLevelType`, for anything that branches on the early grades. */
  gradeType: string;
  gradeLabel: string;
};

/**
 * The advisory placement a teacher may roster into, or `null` when they have
 * none.
 *
 * The pointer on the session user is not enough on its own: a School Head can
 * soft-delete the section after it was assigned, and rostering into a deleted
 * section would put the learner somewhere no roster page lists. So the section is
 * re-read, scoped to the teacher's school and to `deletedAt: null`, and a
 * soft-deleted one reads the same as no assignment at all — which is what the
 * teacher effectively has.
 *
 * One source of truth for both halves of the feature: the roster page uses it to
 * render the placement and to decide whether adding a learner is possible at all,
 * and `createLearner` uses it to derive the placement it writes. They cannot
 * disagree about which grade a teacher belongs to, which is exactly the bug that
 * made the old grade dropdown offer grades the action then refused.
 */
export async function getAdvisoryPlacement(user: {
  id: string;
  schoolId: string;
  advisorySectionId: string | null;
}): Promise<AdvisoryPlacement | null> {
  if (!user.advisorySectionId) return null;

  const section = await prisma.section.findFirst({
    relationLoadStrategy: "join",
    where: {
      id: user.advisorySectionId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
    },
  });
  if (!section) return null;

  return {
    sectionId: section.id,
    sectionName: section.name,
    gradeLevelId: section.gradeLevelId,
    gradeType: section.gradeLevel.type,
    gradeLabel: GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type,
  };
}

/**
 * The one sentence every surface uses when a teacher has no advisory section.
 *
 * Shared so the roster's disabled Add button and the action's rejection say the
 * same thing — a teacher who ignores the first and posts anyway should not get a
 * second, differently-worded explanation of the same situation.
 */
export const NO_ADVISORY_MESSAGE =
  "You have no advisory section yet. Ask your School Head to assign you one before adding learners.";
