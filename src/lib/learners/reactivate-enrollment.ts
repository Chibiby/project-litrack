import type { Prisma, Learner } from "@prisma/client";

export type ReactivateEnrollmentOutcome = "kept" | "revived" | "created" | "no-active-year";

export type ReactivateEnrollmentResult = {
  outcome: ReactivateEnrollmentOutcome;
  enrollmentId: string | null;
};

/**
 * Brings a learner's enrollment back in line with the ACTIVE school year,
 * used by every path that clears a learner's removed/archived state.
 *
 * Precedence, checked in order:
 * 1. An ACTIVE enrollment already exists -> "kept", nothing changes. This is
 *    what protects the SQL-only partial unique index
 *    `Enrollment_learner_active_unique` (one ACTIVE row per learner); it is
 *    checked here so that constraint stays a backstop, not the error surface.
 * 2. No active `SchoolYear` for the learner's school -> "no-active-year",
 *    nothing is created (matches the house rule that creating learners with
 *    no active year skips enrollment creation by design).
 * 3. An ARCHIVED enrollment exists for the active year -> revived to ACTIVE
 *    with `endedAt: null`, and its gradeLevelId/sectionId/teacherId are
 *    overwritten with the learner's CURRENT pointers so the revived row
 *    can never disagree with the denormalized fields on `Learner`.
 * 4. Otherwise -> a new ACTIVE row is created from the learner's current
 *    grade/section/teacher pointers.
 */
export async function reactivateEnrollment(
  tx: Prisma.TransactionClient,
  learner: Pick<Learner, "id" | "schoolId" | "gradeLevelId" | "sectionId" | "teacherId">,
): Promise<ReactivateEnrollmentResult> {
  const existingActive = await tx.enrollment.findFirst({
    where: { learnerId: learner.id, status: "ACTIVE" },
  });
  if (existingActive) {
    return { outcome: "kept", enrollmentId: existingActive.id };
  }

  const activeYear = await tx.schoolYear.findFirst({
    where: { schoolId: learner.schoolId, isActive: true },
  });
  if (!activeYear) {
    return { outcome: "no-active-year", enrollmentId: null };
  }

  const archivedEnrollment = await tx.enrollment.findFirst({
    where: {
      learnerId: learner.id,
      schoolYearId: activeYear.id,
      status: "ARCHIVED",
    },
    orderBy: { endedAt: "desc" },
  });

  if (archivedEnrollment) {
    const revived = await tx.enrollment.update({
      where: { id: archivedEnrollment.id },
      data: {
        status: "ACTIVE",
        endedAt: null,
        gradeLevelId: learner.gradeLevelId,
        sectionId: learner.sectionId,
        teacherId: learner.teacherId,
      },
    });
    return { outcome: "revived", enrollmentId: revived.id };
  }

  const created = await tx.enrollment.create({
    data: {
      learnerId: learner.id,
      schoolId: learner.schoolId,
      schoolYearId: activeYear.id,
      gradeLevelId: learner.gradeLevelId,
      sectionId: learner.sectionId,
      teacherId: learner.teacherId,
      status: "ACTIVE",
    },
  });
  return { outcome: "created", enrollmentId: created.id };
}
