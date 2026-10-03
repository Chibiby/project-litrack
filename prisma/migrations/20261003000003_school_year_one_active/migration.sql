-- At most one active SchoolYear per school, enforced by the database.
-- Prisma's schema language cannot express a partial unique index, so this is
-- SQL-only (see docs/migrations.md "Partial unique index"). SchoolYear has no
-- deletedAt column, so the predicate is just "isActive".
--
-- PRE-FLIGHT (a human MUST run this first). Creating a unique index FAILS if
-- any school already has two active years. This must return zero rows:
--
--   SELECT "schoolId", count(*)
--   FROM "SchoolYear"
--   WHERE "isActive"
--   GROUP BY "schoolId"
--   HAVING count(*) > 1;
--
-- If it returns rows, resolve each school by hand (keep the intended year
-- active, set the others' "isActive" to false) before applying.

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolYear_school_active_unique"
  ON "SchoolYear"("schoolId")
  WHERE "isActive";
