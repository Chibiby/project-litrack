import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Move one learner to another school inside an open transaction. Shared by
 * the Super Admin / District admin instant transfer (`transferLearnerCrossSchool`)
 * and the accept step of a cross-school transfer request, so both keep the
 * learner pointers consistent with the active enrollment the same way:
 *
 *  1. the ACTIVE enrollment ends as TRANSFERRED (the old school keeps it,
 *     read-only, as "Transferred out");
 *  2. the learner's school, grade, section and adviser pointers move, and the
 *     ARAL tutor is cleared (it belongs to the old school);
 *  3. pending section-transfer requests and any other pending school transfer
 *     for the learner are cancelled (nobody at the new school could see them);
 *  4. an ACTIVE enrollment is created when the target school has an active
 *     school year — none otherwise, as before.
 */
export async function applyLearnerSchoolMove(
  tx: Prisma.TransactionClient,
  params: {
    learnerId: string;
    toSchoolId: string;
    gradeLevelId: string;
    sectionId: string | null;
    teacherId: string | null;
    actorId: string;
  }
): Promise<void> {
  const { learnerId, toSchoolId, gradeLevelId, sectionId, teacherId, actorId } = params;
  const now = new Date();

  const active = await tx.enrollment.findFirst({ where: { learnerId, status: "ACTIVE" } });
  if (active) {
    await tx.enrollment.update({
      where: { id: active.id },
      data: { status: "TRANSFERRED", endedAt: now },
    });
  }

  const activeYear = await tx.schoolYear.findFirst({ where: { schoolId: toSchoolId, isActive: true } });

  await tx.learner.update({
    where: { id: learnerId },
    data: {
      schoolId: toSchoolId,
      gradeLevelId,
      sectionId,
      teacherId,
      aralTeacherId: null,
      archivedAt: null,
    },
  });

  await tx.sectionTransferRequest.updateMany({
    where: { learnerId, status: "PENDING" },
    data: { status: "CANCELLED", decidedById: actorId, decidedAt: now },
  });
  await tx.schoolTransferRequest.updateMany({
    where: { learnerId, status: "PENDING" },
    data: { status: "CANCELLED", decidedById: actorId, decidedAt: now },
  });

  if (activeYear) {
    await tx.enrollment.create({
      data: {
        learnerId,
        schoolId: toSchoolId,
        schoolYearId: activeYear.id,
        gradeLevelId,
        sectionId,
        teacherId,
        status: "ACTIVE",
      },
    });
  }
}
