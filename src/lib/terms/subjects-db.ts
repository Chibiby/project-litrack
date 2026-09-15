import "server-only";
import { Prisma, type GradeLevelType, type PrismaClient } from "@prisma/client";
import { orderSheetSubjects } from "@/lib/terms/subjects";

type Client = PrismaClient | Prisma.TransactionClient;

export type TermSubjectRow = {
  id: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

const SELECT = { id: true, name: true, position: true, deletedAt: true } as const;

export type TermSubjectDefaultRow = {
  id: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

const DEFAULT_SELECT = { id: true, name: true, position: true, deletedAt: true } as const;

/**
 * One grade type's active template rows (`TermSubjectDefault`), in display
 * order. The Super Admin's per-type template — never touches a school's own
 * `TermSubject` rows.
 */
export async function getActiveDefaultsForType(
  client: Client,
  gradeLevelType: GradeLevelType
): Promise<TermSubjectDefaultRow[]> {
  const rows = await client.termSubjectDefault.findMany({
    where: { gradeLevelType, deletedAt: null },
    select: DEFAULT_SELECT,
  });
  return orderSheetSubjects(rows);
}

/**
 * Every subject row for one grade, archived included, seeding from that
 * grade's `GradeLevelType` template (`TermSubjectDefault`) first when the
 * grade has NO rows at all.
 *
 * Lazy seed because grades are created from several paths and M1 only seeded
 * the grades that existed then. "Zero rows" (not "zero active") is the trigger,
 * so a head who archived every subject is never handed the defaults back.
 * `skipDuplicates` compiles to an untargeted `ON CONFLICT DO NOTHING`, and
 * the SQL-only `TermSubject_grade_active_name_unique` index is what stops two
 * concurrent first reads from double-seeding. Seeded rows carry
 * `legacyArea = NULL`, so `@@unique([gradeLevelId, legacyArea])` no longer helps.
 *
 * The template read is per-`GradeLevelType`, edited by the Super Admin
 * (`term-subject-defaults.ts`) — a zero-default type (or a grade whose id
 * cannot be resolved, which should not happen for a caller-verified grade)
 * seeds nothing and leaves the sheet empty; there is no further fallback.
 * Seeded rows carry `legacyArea: null` — that join key only ever mattered for
 * the pre-M2 backfill of rows this path never creates.
 *
 * TENANCY: `schoolId` must be the caller's already-verified school; the where
 * clause carries it, and the composite FK makes a grade/school mismatch
 * impossible to insert.
 */
export async function getAllTermSubjects(
  client: Client,
  { schoolId, gradeLevelId }: { schoolId: string; gradeLevelId: string }
): Promise<TermSubjectRow[]> {
  const where = { schoolId, gradeLevelId };
  const rows = await client.termSubject.findMany({ where, select: SELECT });
  if (rows.length > 0) return rows;

  const grade = await client.gradeLevel.findFirst({
    where: { id: gradeLevelId, schoolId },
    select: { type: true },
  });
  if (!grade) return rows;

  const defaults = await getActiveDefaultsForType(client, grade.type);
  if (defaults.length === 0) return rows;

  await client.termSubject.createMany({
    data: defaults.map((d, position) => ({
      schoolId,
      gradeLevelId,
      name: d.name,
      position,
      legacyArea: null,
    })),
    skipDuplicates: true,
  });
  return client.termSubject.findMany({ where, select: SELECT });
}

/** The active subjects of one grade's sheet, in display order. */
export async function getSheetSubjects(
  client: Client,
  args: { schoolId: string; gradeLevelId: string }
): Promise<TermSubjectRow[]> {
  return orderSheetSubjects(await getAllTermSubjects(client, args));
}

/**
 * Point legacy `TermGrade` rows (saved by the pre-TermSubject build after M1
 * applied, so `termSubjectId IS NULL`) at this grade's TermSubject for the
 * same `legacyArea`. Without it those scores are invisible to every
 * termSubjectId-keyed reader, and a re-typed score would create a second row.
 *
 * Scope: rows whose learner CURRENTLY belongs to this grade in this school,
 * matched only to this grade's TermSubject in this school. Idempotent: writes
 * only where `termSubjectId IS NULL`. The NOT EXISTS guard skips a row whose
 * target (learner, year, term, termSubjectId) is already taken, so it can never
 * violate `TermGrade_learnerId_schoolYearId_term_termSubjectId_key`.
 *
 * Must run AFTER `getSheetSubjects` (the lazy seed creates the legacyArea rows
 * it joins to). A no-op once M2 makes `termSubjectId` NOT NULL; delete it and
 * its call sites with M3.
 */
export async function healLegacyTermGrades(
  client: Client,
  {
    schoolId,
    gradeLevelId,
    schoolYearId,
  }: { schoolId: string; gradeLevelId: string; schoolYearId?: string }
): Promise<number> {
  const yearFilter = schoolYearId
    ? Prisma.sql`AND tg."schoolYearId" = ${schoolYearId}`
    : Prisma.empty;
  return client.$executeRaw(Prisma.sql`
    UPDATE "TermGrade" tg
    SET "termSubjectId" = ts."id"
    FROM "Learner" l, "TermSubject" ts
    WHERE tg."termSubjectId" IS NULL
      ${yearFilter}
      AND l."id" = tg."learnerId"
      AND l."schoolId" = ${schoolId}
      AND l."gradeLevelId" = ${gradeLevelId}
      AND ts."schoolId" = ${schoolId}
      AND ts."gradeLevelId" = ${gradeLevelId}
      AND ts."legacyArea" = tg."subject"
      AND NOT EXISTS (
        SELECT 1 FROM "TermGrade" o
        WHERE o."learnerId" = tg."learnerId"
          AND o."schoolYearId" = tg."schoolYearId"
          AND o."term" = tg."term"
          AND o."termSubjectId" = ts."id"
      )
  `);
}

/**
 * The management page's view: active in display order, then archived (most
 * recently archived first).
 */
export async function getManagedTermSubjects(
  client: Client,
  args: { schoolId: string; gradeLevelId: string }
): Promise<{ active: TermSubjectRow[]; archived: TermSubjectRow[] }> {
  const rows = await getAllTermSubjects(client, args);
  const archived = rows
    .filter((r): r is TermSubjectRow & { deletedAt: Date } => r.deletedAt !== null)
    .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return { active: orderSheetSubjects(rows), archived };
}
