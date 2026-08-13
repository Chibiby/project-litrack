import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Resolve (creating or restoring as needed) the per-school FLOATING grade level.
 *
 * A "floating" learner is one with no real grade/section yet: they point at this
 * grade with `sectionId = null`. `Learner.gradeLevelId` is NOT NULL, so every
 * learner needs a grade row even when unplaced — hence the lazily created
 * FLOATING grade instead of a nullable pointer.
 *
 * `GradeLevel @@unique([schoolId, type])` ignores `deletedAt`, so a soft-deleted
 * FLOATING row makes an insert fail with P2002 forever. The upsert restores that
 * row (`deletedAt: null`) instead of trying to insert a second one, matching the
 * grade/section restore pattern in `createGradeLevel` / `bootstrapSchoolStructure`.
 *
 * Caller supplies `schoolId` from the authenticated session — never from input.
 */
export async function ensureFloatingGradeLevel(
  tx: Tx,
  schoolId: string
): Promise<string> {
  const grade = await tx.gradeLevel.upsert({
    where: { schoolId_type: { schoolId, type: "FLOATING" } },
    update: { deletedAt: null },
    create: { schoolId, type: "FLOATING" },
    select: { id: true },
  });

  return grade.id;
}
