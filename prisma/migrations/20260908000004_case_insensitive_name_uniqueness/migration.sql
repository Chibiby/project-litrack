-- ===========================================================================
-- Case-insensitive uniqueness for school names, School IDs and section names
-- ===========================================================================
-- STOP. Do not apply this until prisma/reports/data-uniformity-preflight.sql
-- returns zero rows for sections 1, 2 and 3. Each index below WILL fail to
-- create while a case-variant duplicate exists, and the failure aborts the
-- whole migration. That is deliberate: silently picking a winner between two
-- real schools is worse than refusing to apply.
--
-- The application-side probes in createSchool, createSection and updateSection
-- already fold case, so nothing new can be created. These indexes close the
-- race between two concurrent requests and make the rule a database guarantee
-- rather than a convention.
--
-- Stored casing is untouched. In particular schoolIdCode keeps exactly the
-- characters the admin typed, because it doubles as the School Head's
-- first-login password — folding the value would change that password.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- School.name — replaces the plain @unique with a folded functional index.
-- Prisma's schema language cannot express a functional unique, so this lives in
-- SQL only, like School_schoolIdCode_real_key and Enrollment's partial index.
-- Preserve it when editing School migrations.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "School_name_key";

CREATE UNIQUE INDEX "School_name_folded_key"
  ON "School" (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- School.schoolIdCode — the real-schools-only rule from
-- 20260908000002_demo_school_id_exempt_from_unique, now case-insensitive. The
-- demo tenant stays exempt for the same reason as before: it deliberately
-- carries an ID a real school already owns.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "School_schoolIdCode_real_key";

CREATE UNIQUE INDEX "School_schoolIdCode_real_key"
  ON "School" (lower("schoolIdCode"))
  WHERE "isDemo" = false;

-- ---------------------------------------------------------------------------
-- Section — one name per grade, case-insensitively, among live sections only.
-- Soft-deleted rows are excluded so an archived "Mabini" does not block a new
-- one; createSection revives the archived row when it finds it.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Section_gradeLevelId_name_key";

CREATE UNIQUE INDEX "Section_gradeLevelId_name_folded_key"
  ON "Section" ("gradeLevelId", lower(btrim(name)))
  WHERE "deletedAt" IS NULL;
