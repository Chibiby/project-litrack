import type { Prisma } from "@prisma/client";

/**
 * The learner population every "how many learners" figure counts: live
 * learners holding an ACTIVE enrollment in an active school year.
 *
 * A learner's ACTIVE enrollment is unique (partial index) and belongs to their
 * school, so grouping by the learner's `schoolId` attributes each one to
 * exactly one school. The dashboard IP metrics and the division summary
 * (`src/lib/summary/**`) both count this population, so the two can never
 * disagree on the learner total. The summary's raw SQL spells the same rule
 * out as `ACTIVE_ENROLLED_LEARNER_SQL` in `src/lib/summary/queries/population.ts`.
 */
export const ACTIVE_ENROLLED_LEARNER: Prisma.LearnerWhereInput = {
  deletedAt: null,
  enrollments: { some: { status: "ACTIVE", schoolYear: { isActive: true } } },
};
