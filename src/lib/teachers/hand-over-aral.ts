import type { Prisma } from "@prisma/client";
import { aralTeacherScope } from "@/lib/teachers/aral-teacher";

export type AralHandover = {
  /** One entry per adviser who picked learners up, with the learners they got. */
  moved: { adviserId: string; learnerIds: string[] }[];
  /**
   * ARAL learners left with the outgoing teacher: no adviser, an adviser who is
   * the outgoing teacher, or an adviser who cannot hold a designation (inactive,
   * removed, pending). The School Head assigns these by hand.
   */
  keptCount: number;
};

/**
 * Hand a teacher's ARAL learners to each learner's own adviser.
 *
 * Runs when a School Head deactivates a teacher: a deactivated teacher cannot
 * sign in, so the learners they tutor would otherwise go untracked. The adviser
 * already knows the learner, so they are the natural next tutor. A learner whose
 * adviser is missing or not eligible stays where it is, and is counted, rather
 * than being moved to someone the School Head did not choose.
 *
 * Tenant-scoped by `schoolId` on every read and write.
 */
export async function handAralLearnersToAdvisers(
  tx: Prisma.TransactionClient,
  input: { teacherId: string; schoolId: string }
): Promise<AralHandover> {
  const learners = await tx.learner.findMany({
    where: {
      schoolId: input.schoolId,
      aralTeacherId: input.teacherId,
      isAralLearner: true,
      deletedAt: null,
    },
    select: { id: true, teacherId: true },
  });
  if (learners.length === 0) return { moved: [], keptCount: 0 };

  const adviserIds = [
    ...new Set(
      learners
        .map((l) => l.teacherId)
        .filter((id): id is string => !!id && id !== input.teacherId)
    ),
  ];
  const eligible =
    adviserIds.length === 0
      ? []
      : await tx.user.findMany({
          where: { id: { in: adviserIds }, ...aralTeacherScope(input.schoolId) },
          select: { id: true },
        });
  const eligibleIds = new Set(eligible.map((u) => u.id));

  const byAdviser = new Map<string, string[]>();
  for (const l of learners) {
    if (!l.teacherId || !eligibleIds.has(l.teacherId)) continue;
    const list = byAdviser.get(l.teacherId) ?? [];
    list.push(l.id);
    byAdviser.set(l.teacherId, list);
  }

  const moved: AralHandover["moved"] = [];
  for (const [adviserId, learnerIds] of byAdviser) {
    await tx.learner.updateMany({
      // `aralTeacherId` stays in the `where` so a learner redesignated by
      // someone else in the meantime is not pulled back.
      where: {
        id: { in: learnerIds },
        schoolId: input.schoolId,
        aralTeacherId: input.teacherId,
      },
      data: { aralTeacherId: adviserId },
    });
    moved.push({ adviserId, learnerIds });
  }

  const movedCount = moved.reduce((n, m) => n + m.learnerIds.length, 0);
  return { moved, keptCount: learners.length - movedCount };
}
