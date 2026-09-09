-- ===========================================================================
-- A second ethnicity slot, and ethnicity on the teacher profile
-- ===========================================================================
-- Two related changes to the same question.
--
--   1. Learners may now record a second ethnicity, for someone of mixed
--      heritage. The form still shows one select; the second appears behind an
--      "Add another ethnicity" button.
--
--   2. Teachers are asked the ethnicity question at all. Section I, Respondent
--      Information, previously went straight from the name to the contact
--      number.
--
-- Two named columns rather than an "Ethnicity"[] array: the cap really is two,
-- and an array would force every existing read, CSV column and report to be
-- rewritten to say what it already says.
--
-- Purely additive. Six nullable columns, no new type (the "Ethnicity" enum has
-- existed since 20260811000001_learner_ethnicity), nothing dropped, renamed or
-- backfilled. No ADD COLUMN here carries a default, so Postgres records a
-- catalog-only change and takes no table rewrite; the ACCESS EXCLUSIVE lock on
-- each table is momentary.
--
-- Existing rows read as NULL, which is exactly what the app already shows for a
-- learner rostered before ethnicity was collected, and for every teacher
-- profile completed before today. Nullability is not tightened later: the
-- second slot is genuinely optional, and the first is optional for teachers on
-- profiles that predate the question.
-- ===========================================================================

-- AlterTable
ALTER TABLE "Learner"
  ADD COLUMN "secondaryEthnicity" "Ethnicity",
  ADD COLUMN "secondaryEthnicityOther" TEXT;

-- AlterTable
ALTER TABLE "TeacherProfile"
  ADD COLUMN "ethnicity" "Ethnicity",
  ADD COLUMN "ethnicityOther" TEXT,
  ADD COLUMN "secondaryEthnicity" "Ethnicity",
  ADD COLUMN "secondaryEthnicityOther" TEXT;

-- No index on any of the six, deliberately, and for the same reason the first
-- learner ethnicity column has none: these are form answers read alongside a
-- row already being fetched by primary key or by an existing schoolId
-- composite. They are not filters or join keys, and at thirteen values they are
-- too low-cardinality to be selective if one ever became one.

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- ALTER TABLE "TeacherProfile"
--   DROP COLUMN "secondaryEthnicityOther",
--   DROP COLUMN "secondaryEthnicity",
--   DROP COLUMN "ethnicityOther",
--   DROP COLUMN "ethnicity";
-- ALTER TABLE "Learner"
--   DROP COLUMN "secondaryEthnicityOther",
--   DROP COLUMN "secondaryEthnicity";
--
-- Destructive only of answers given after this migration was applied; no row
-- that exists today depends on any of these columns. Leave the "Ethnicity" type
-- in place — "Learner"."ethnicity" still uses it.
