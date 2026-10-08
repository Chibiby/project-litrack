import "server-only";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/app-error";

/**
 * Move a batch of learners into one section of their grade, inside the
 * caller's transaction. Shared by the School Head's direct transfer and by an
 * approved teacher request (docs/specs/learner-section-transfers.md §2c).
 *
 * A fixed number of statements whatever the batch size — never one per
 * learner. Production runs on Workers, where an interactive transaction doing a
 * few hundred round trips risks timing out:
 *
 * 1. Compare-and-set the learners: each must still be live, in this school and
 *    grade, and in the section it was read from. A short count means somebody
 *    else moved, archived or removed one in between, and the throw rolls the
 *    whole transaction back.
 * 2. Read the ACTIVE enrollments' school years (plus the school's active year,
 *    once, only when some learner has no ACTIVE row).
 * 3. Close the ACTIVE rows as TRANSFERRED.
 * 4. Create the new ACTIVE rows. Close comes before create because the partial
 *    unique index `Enrollment_learner_active_unique` allows one ACTIVE row per
 *    learner. A learner with no school year at all gets pointers only — the same
 *    rule `transferLearner` and learner creation follow.
 *
 * Tenancy: steps 2–4 key on `learnerId` alone, like `transferLearner` does,
 * because step 1 has already proved every id is a live learner of `schoolId`
 * (a short count throws before they run). Leaving `schoolId` off the close is
 * deliberate: an ACTIVE row carrying another school id would otherwise survive
 * and break the one-ACTIVE-row index on the create.
 */
export type SectionTransferMove = {
  learnerId: string;
  /** The section the learner was read in; null for a learner with none. */
  fromSectionId: string | null;
};

export type ApplySectionTransferInput = {
  schoolId: string;
  gradeLevelId: string;
  toSectionId: string;
  /** The destination section's adviser, read at apply time, never stored. */
  teacherId: string;
  moves: SectionTransferMove[];
  now: Date;
};

export async function applySectionTransferBatch(
  tx: Prisma.TransactionClient,
  input: ApplySectionTransferInput
): Promise<{ moved: number }> {
  const { schoolId, gradeLevelId, toSectionId, teacherId, moves, now } = input;
  if (moves.length === 0) return { moved: 0 };

  const learnerIds = moves.map((m) => m.learnerId);

  // 1. Compare-and-set.
  const { count } = await tx.learner.updateMany({
    where: {
      schoolId,
      gradeLevelId,
      deletedAt: null,
      archivedAt: null,
      OR: moves.map((m) => ({ id: m.learnerId, sectionId: m.fromSectionId })),
    },
    data: { sectionId: toSectionId, teacherId },
  });
  if (count !== moves.length) {
    throw new AppError("TRANSFER_REQUESTS_CHANGED", {
      detail: `learner compare-and-set matched ${count} of ${moves.length}`,
    });
  }

  // 2. Which school year each new ACTIVE row belongs to.
  const active = await tx.enrollment.findMany({
    where: { learnerId: { in: learnerIds }, status: "ACTIVE" },
    select: { learnerId: true, schoolYearId: true },
  });
  const yearByLearner = new Map(active.map((row) => [row.learnerId, row.schoolYearId]));
  let fallbackYearId: string | null = null;
  if (yearByLearner.size < learnerIds.length) {
    const activeYear = await tx.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { id: true },
    });
    fallbackYearId = activeYear?.id ?? null;
  }

  // 3. Close before create (one ACTIVE row per learner).
  if (active.length > 0) {
    await tx.enrollment.updateMany({
      where: { learnerId: { in: learnerIds }, status: "ACTIVE" },
      data: { status: "TRANSFERRED", endedAt: now },
    });
  }

  // 4. The new ACTIVE rows, for learners that have a school year.
  const data: Prisma.EnrollmentCreateManyInput[] = [];
  for (const learnerId of learnerIds) {
    const schoolYearId = yearByLearner.get(learnerId) ?? fallbackYearId;
    if (!schoolYearId) continue;
    data.push({
      learnerId,
      schoolId,
      schoolYearId,
      gradeLevelId,
      sectionId: toSectionId,
      teacherId,
      status: "ACTIVE",
    });
  }
  if (data.length > 0) {
    await tx.enrollment.createMany({ data });
  }

  return { moved: count };
}
