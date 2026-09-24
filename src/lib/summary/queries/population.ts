import { Prisma } from "@prisma/client";

/**
 * The learner population, spelled out for raw SQL.
 *
 * Same rule as `ACTIVE_ENROLLED_LEARNER` (`src/lib/learners/population.ts`): a
 * live learner holding an ACTIVE enrollment in an active school year. Keep the
 * two in step; the division learner count must equal the dashboard's.
 *
 * `l` must be the `"Learner"` alias.
 */
export const ACTIVE_ENROLLED_LEARNER_SQL = Prisma.sql`
  l."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Enrollment" e
    JOIN "SchoolYear" sy ON sy."id" = e."schoolYearId"
    WHERE e."learnerId" = l."id"
      AND e."status" = 'ACTIVE'
      AND sy."isActive" = true
  )`;

/**
 * The tenancy fence of every summary query: the learner's school is one of
 * the ids `resolveScopeSchools` returned for the caller's scope.
 */
export function inScopeSchools(column: Prisma.Sql, schoolIds: readonly string[]): Prisma.Sql {
  return Prisma.sql`${column} = ANY(${[...schoolIds]}::text[])`;
}

/**
 * `pop` CTE body: the in-scope population with its current grade type.
 * `aral` narrows it to ARAL learners (reading behaviour, attendance, monthly
 * reading level).
 */
export function populationCte(
  schoolIds: readonly string[],
  opts: { aral: boolean; columns?: Prisma.Sql }
): Prisma.Sql {
  const extra = opts.columns ? Prisma.sql`, ${opts.columns}` : Prisma.empty;
  const aral = opts.aral ? Prisma.sql`AND l."isAralLearner" = true` : Prisma.empty;
  return Prisma.sql`
    SELECT l."id", l."schoolId", l."gradeLevelId", g."type"::text AS gt${extra}
    FROM "Learner" l
    JOIN "GradeLevel" g ON g."id" = l."gradeLevelId"
    WHERE ${inScopeSchools(Prisma.sql`l."schoolId"`, schoolIds)}
      AND ${ACTIVE_ENROLLED_LEARNER_SQL}
      ${aral}`;
}

/** The shape most facet queries return: counts at (school, grade, field, bucket). */
export type RawCountRow = {
  school_id: string;
  gt: string | null;
  field: string;
  bucket: string | null;
  count: number;
};
