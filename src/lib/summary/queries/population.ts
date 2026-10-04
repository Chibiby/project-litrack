import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
 * `pop` CTE body: the population of EVERY school with its current grade type.
 * `aral` narrows it to ARAL learners (reading behaviour, attendance, monthly
 * reading level).
 *
 * TENANCY: there is deliberately no school filter here. Summary SQL returns
 * every school's rows, keyed by `school_id`, into one division-wide cache
 * entry; `scopeRaw` (`src/lib/summary/scoped-raw.ts`) is the fence that keeps
 * only the caller's schools before anything is shaped.
 */
export function populationCte(opts: { aral: boolean; columns?: Prisma.Sql }): Prisma.Sql {
  const extra = opts.columns ? Prisma.sql`, ${opts.columns}` : Prisma.empty;
  const aral = opts.aral ? Prisma.sql`AND l."isAralLearner" = true` : Prisma.empty;
  return Prisma.sql`
    SELECT l."id", l."schoolId", l."gradeLevelId", g."type"::text AS gt${extra}
    FROM "Learner" l
    JOIN "GradeLevel" g ON g."id" = l."gradeLevelId"
    WHERE ${ACTIVE_ENROLLED_LEARNER_SQL}
      ${aral}`;
}

/** Interactive-transaction limits for one summary statement; see `runSummaryQuery`. */
export const SUMMARY_TX_OPTIONS = { timeout: 30000, maxWait: 10000 } as const;

/**
 * Run one summary statement with `work_mem` raised for that statement only.
 *
 * The `WITH pop` shapes are the top temp-file writers in pg_stat_statements:
 * at the 4 MB default their sorts and the materialized `pop` spill to disk
 * (EXPLAIN on production: ~16.7 MB for attendance, ~8.7 MB for learners).
 * `SET LOCAL` lasts for this one transaction (PgBouncer transaction pooling
 * releases the backend at commit), so no other query on the connection sees
 * it. The explicit timeout replaces Prisma's 5000 ms interactive-transaction
 * default (P2028): a cold division-wide learners run measured 6.2 s.
 */
export function runSummaryQuery<T>(sql: Prisma.Sql): Promise<T[]> {
  return prisma.$transaction(async (tx) => {
    // A literal, not a bound parameter: SET does not accept `$1`.
    await tx.$executeRaw`SET LOCAL work_mem = '64MB'`;
    return tx.$queryRaw<T[]>(sql);
  }, SUMMARY_TX_OPTIONS);
}

/** The shape most facet queries return: counts at (school, grade, field, bucket). */
export type RawCountRow = {
  school_id: string;
  gt: string | null;
  field: string;
  bucket: string | null;
  count: number;
};
