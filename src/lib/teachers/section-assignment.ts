import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Load non-deleted sections that belong to `schoolId`.
 * Throws if any requested id is missing / wrong school / soft-deleted.
 */
async function loadValidSections(
  tx: Tx,
  sectionIds: string[],
  schoolId: string
): Promise<{ id: string; gradeLevelId: string }[]> {
  const ids = uniqueIds(sectionIds);
  if (ids.length === 0) return [];

  const sections = await tx.section.findMany({
    where: {
      id: { in: ids },
      schoolId,
      deletedAt: null,
    },
    select: { id: true, gradeLevelId: true },
  });

  if (sections.length !== ids.length) {
    throw new Error("One or more sections are invalid or do not belong to this school");
  }

  return sections;
}

/**
 * Additive assign: upsert TeacherSection rows and connect taughtGrades for
 * each distinct gradeLevelId of those sections. Does not remove existing
 * assignments.
 */
export async function assignTeacherToSections(
  tx: Tx,
  params: { teacherId: string; sectionIds: string[]; schoolId: string }
): Promise<void> {
  const { teacherId, schoolId } = params;
  const sectionIds = uniqueIds(params.sectionIds);
  if (sectionIds.length === 0) return;

  const sections = await loadValidSections(tx, sectionIds, schoolId);

  await tx.teacherSection.createMany({
    data: sections.map((s) => ({
      teacherId,
      sectionId: s.id,
    })),
    skipDuplicates: true,
  });

  const gradeIds = uniqueIds(sections.map((s) => s.gradeLevelId));
  if (gradeIds.length === 0) return;

  await tx.user.update({
    where: { id: teacherId },
    data: {
      taughtGrades: {
        connect: gradeIds.map((id) => ({ id })),
      },
    },
  });
}

/**
 * Replace assign: set TeacherSection exactly to `sectionIds`, then sync
 * taughtGrades so only grades backed by at least one assigned section remain
 * connected (and newly covered grades are connected).
 */
export async function setTeacherSections(
  tx: Tx,
  params: { teacherId: string; sectionIds: string[]; schoolId: string }
): Promise<void> {
  const { teacherId, schoolId } = params;
  const sectionIds = uniqueIds(params.sectionIds);

  const sections = await loadValidSections(tx, sectionIds, schoolId);
  const validIds = sections.map((s) => s.id);

  if (validIds.length === 0) {
    await tx.teacherSection.deleteMany({ where: { teacherId } });
  } else {
    await tx.teacherSection.deleteMany({
      where: {
        teacherId,
        sectionId: { notIn: validIds },
      },
    });

    await tx.teacherSection.createMany({
      data: validIds.map((sectionId) => ({
        teacherId,
        sectionId,
      })),
      skipDuplicates: true,
    });
  }

  const targetGradeIds = uniqueIds(sections.map((s) => s.gradeLevelId));

  const teacher = await tx.user.findUniqueOrThrow({
    where: { id: teacherId },
    select: { taughtGrades: { select: { id: true } } },
  });
  const currentGradeIds = teacher.taughtGrades.map((g) => g.id);

  const toConnect = targetGradeIds.filter((id) => !currentGradeIds.includes(id));
  const toDisconnect = currentGradeIds.filter((id) => !targetGradeIds.includes(id));

  if (toConnect.length === 0 && toDisconnect.length === 0) return;

  await tx.user.update({
    where: { id: teacherId },
    data: {
      taughtGrades: {
        ...(toConnect.length > 0 ? { connect: toConnect.map((id) => ({ id })) } : {}),
        ...(toDisconnect.length > 0
          ? { disconnect: toDisconnect.map((id) => ({ id })) }
          : {}),
      },
    },
  });
}
