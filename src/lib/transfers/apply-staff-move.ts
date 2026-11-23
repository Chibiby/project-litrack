import "server-only";
import type { Prisma } from "@prisma/client";

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

  if (advisedIds.size > 0) {
    await tx.section.updateMany({
      where: { id: { in: [...advisedIds] } },
      data: { adviserId: null },
    });
  }
  await tx.teacherSection.deleteMany({
    where: { teacherId: userId, section: { schoolId: fromSchoolId } },
  });
  await tx.learner.updateMany({
    where: { schoolId: fromSchoolId, teacherId: userId },
    data: { teacherId: null },
  });
  await tx.user.update({
    where: { id: userId },
    data: { schoolId: toSchoolId, advisorySectionId: null },
  });

  return { clearedSections: advisedIds.size, retutored, untutored };
}
