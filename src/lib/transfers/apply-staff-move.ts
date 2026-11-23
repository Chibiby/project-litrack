import "server-only";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors/app-error";
import { releaseTeacherAdvisory } from "@/lib/teachers/release-advisory";

/**
 * Move a teacher or ARAL volunteer account to another school inside an open
 * transaction (owner rules in the cross-school transfers design):
 *
 *  - every ARAL learner they tutored at the old school gets the adviser of the
 *    learner's own section as tutor; when that section has no other adviser,
 *    the learner has no tutor until the School Head assigns one;
 *  - their advisory sections stay, with no adviser (the "sections have no
 *    adviser" callout picks them up), and the legacy mirrors are cleared;
 *  - learners whose adviser pointer named them have it cleared;
 *  - the account's school changes, so they choose the new school at sign-in.
 *
 * History (`AralMosyDecision.tutorId`, attendance `recordedById`) is left as is.
 */
export async function applyStaffSchoolMove(
  tx: Prisma.TransactionClient,
  params: { userId: string; fromSchoolId: string; toSchoolId: string }
): Promise<{ clearedSections: number; retutored: number; untutored: number }> {
  const { userId, fromSchoolId, toSchoolId } = params;

  // Guarded first: the caller checked the account before the transaction, and
  // it may have been removed, deactivated or moved since. Nothing else moves
  // then, and the caller's transaction rolls back.
  const { count } = await tx.user.updateMany({
    where: { id: userId, schoolId: fromSchoolId, deletedAt: null, isActive: true },
    data: { schoolId: toSchoolId, advisorySectionId: null },
  });
  if (count !== 1) throw new AppError("TRANSFER_REQUESTS_CHANGED");

  const advised = await tx.section.findMany({
    where: { schoolId: fromSchoolId, adviserId: userId },
    select: { id: true },
  });
  const advisedIds = new Set(advised.map((s) => s.id));

  const tutored = await tx.learner.findMany({
    where: { schoolId: fromSchoolId, aralTeacherId: userId },
    select: { id: true, section: { select: { id: true, adviserId: true } } },
  });

  // Group by the tutor each learner falls back to, one write per group.
  const byNewTutor = new Map<string | null, string[]>();
  for (const l of tutored) {
    const adviser = l.section?.adviserId ?? null;
    const next = adviser && adviser !== userId && !advisedIds.has(l.section!.id) ? adviser : null;
    byNewTutor.set(next, [...(byNewTutor.get(next) ?? []), l.id]);
  }
  let retutored = 0;
  let untutored = 0;
  for (const [aralTeacherId, ids] of byNewTutor) {
    await tx.learner.updateMany({ where: { id: { in: ids } }, data: { aralTeacherId } });
    if (aralTeacherId) retutored += ids.length;
    else untutored += ids.length;
  }

  // After the re-tutoring, so it only finds learners still naming them. The
  // same release the removal paths use: Section.adviserId, Learner.teacherId,
  // the ACTIVE Enrollment.teacherId and the TeacherSection / taughtGrades
  // mirrors move together, scoped to the old school.
  const released = await releaseTeacherAdvisory(tx, { teacherId: userId, schoolId: fromSchoolId });

  return { clearedSections: released.sectionIds.length, retutored, untutored };
}
