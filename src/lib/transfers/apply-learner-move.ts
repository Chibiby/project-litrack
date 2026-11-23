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

/**
 * Move many learners from one sending school to one placement at the
 * receiving school, inside an open transaction, in a fixed number of
 * statements whatever the batch size (the accept step of cross-school
 * transfer requests). A per-learner loop costs about eight round trips each,
 * and at production latency a handful of learners blows the transaction
 * budget (see `src/lib/db/bulk-write.ts`).
 *
 * Same four steps as `applyLearnerSchoolMove`, with one difference: the
 * learner update is guarded. It only moves learners still live at the sending
 * school (not archived, not removed, not moved elsewhere since the caller's
 * check), and returns how many it moved. When that is fewer than asked, it
 * writes nothing more and the caller must throw so the transaction rolls back.
 */
export async function applyLearnerSchoolMoves(
  tx: Prisma.TransactionClient,
  params: {
    learnerIds: string[];
    fromSchoolId: string;
    toSchoolId: string;
    gradeLevelId: string;
    sectionId: string | null;
    teacherId: string | null;
    actorId: string;
  }
): Promise<{ moved: number }> {
  const { learnerIds, fromSchoolId, toSchoolId, gradeLevelId, sectionId, teacherId, actorId } = params;
  const now = new Date();
  const ids = { in: learnerIds };

  const { count: moved } = await tx.learner.updateMany({
    where: { id: ids, schoolId: fromSchoolId, deletedAt: null, archivedAt: null },
    data: { schoolId: toSchoolId, gradeLevelId, sectionId, teacherId, aralTeacherId: null },
  });
  if (moved !== learnerIds.length) return { moved };

  // Close before create: one ACTIVE row per learner (partial unique index).
  await tx.enrollment.updateMany({
    where: { learnerId: ids, status: "ACTIVE" },
    data: { status: "TRANSFERRED", endedAt: now },
  });
  const activeYear = await tx.schoolYear.findFirst({ where: { schoolId: toSchoolId, isActive: true } });

  await tx.sectionTransferRequest.updateMany({
    where: { learnerId: ids, status: "PENDING" },
    data: { status: "CANCELLED", decidedById: actorId, decidedAt: now },
  });
  await tx.schoolTransferRequest.updateMany({
    where: { learnerId: ids, status: "PENDING" },
    data: { status: "CANCELLED", decidedById: actorId, decidedAt: now },
  });

  if (activeYear) {
    await tx.enrollment.createMany({
      data: learnerIds.map((learnerId) => ({
        learnerId,
        schoolId: toSchoolId,
        schoolYearId: activeYear.id,
        gradeLevelId,
        sectionId,
        teacherId,
        status: "ACTIVE" as const,
      })),
    });
  }
  return { moved };
}
