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

/** Prisma unique-constraint violation (here: two advisers for one section). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Shared user-facing message for {@link isUniqueViolation} on
 * `User.advisorySectionId` — every caller of {@link setTeacherAdvisory} maps
 * P2002 to this exact text so it never drifts between call sites.
 */
export const SECTION_TAKEN_ERROR = "That section already has an adviser.";

/**
 * Set a teacher's advisory section — the authoritative assignment axis.
 *
 * `User.advisorySectionId` is the source of truth (unique, so one adviser per
 * section) and the teacher's grade is DERIVED from that section. The legacy
 * `TeacherSection` m2m and `User.taughtGrades` mirror are still dual-written
 * because reads have not all migrated yet; dropping them is a later wave.
 *
 * Throws Prisma P2002 when another teacher already advises `sectionId` — the
 * calling action maps that to a user-facing message rather than swallowing it,
 * so an adviser is never silently stolen from a section.
 */
export async function setTeacherAdvisory(
  tx: Tx,
  params: { teacherId: string; sectionId: string | null; schoolId: string }
): Promise<{ sectionId: string | null; gradeLevelId: string | null }> {
  const { teacherId, sectionId, schoolId } = params;

  const sections = sectionId
    ? await loadValidSections(tx, [sectionId], schoolId)
    : [];
  const section = sections[0] ?? null;
  const targetGradeIds = section ? [section.gradeLevelId] : [];

  // Legacy mirror: drop every TeacherSection row that is not the advisory one.
  await tx.teacherSection.deleteMany({
    where: {
      teacherId,
      ...(section ? { sectionId: { not: section.id } } : {}),
    },
  });
  if (section) {
    await tx.teacherSection.createMany({
      data: [{ teacherId, sectionId: section.id }],
      skipDuplicates: true,
    });
  }

  const teacher = await tx.user.findUniqueOrThrow({
    where: { id: teacherId },
    select: { advisorySectionId: true, taughtGrades: { select: { id: true } } },
  });
  const currentGradeIds = teacher.taughtGrades.map((g) => g.id);
  const toConnect = targetGradeIds.filter((id) => !currentGradeIds.includes(id));
  const toDisconnect = currentGradeIds.filter((id) => !targetGradeIds.includes(id));

  const nextAdvisoryId = section?.id ?? null;
  const advisoryChanged = teacher.advisorySectionId !== nextAdvisoryId;

  if (advisoryChanged || toConnect.length > 0 || toDisconnect.length > 0) {
    await tx.user.update({
      where: { id: teacherId },
      data: {
        ...(advisoryChanged ? { advisorySectionId: nextAdvisoryId } : {}),
        taughtGrades: {
          ...(toConnect.length > 0 ? { connect: toConnect.map((id) => ({ id })) } : {}),
          ...(toDisconnect.length > 0
            ? { disconnect: toDisconnect.map((id) => ({ id })) }
            : {}),
        },
      },
    });
  }

  return { sectionId: nextAdvisoryId, gradeLevelId: section?.gradeLevelId ?? null };
}
