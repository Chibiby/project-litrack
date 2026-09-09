-- Two additions to the learner profiling forms.
--
--   Learner.nutritionalStatus       Section A. Nullable on purpose: every learner
--                                   rostered before this column existed never
--                                   answered the question, and a default would
--                                   make those rows claim an answer nobody gave.
--                                   The requirement is enforced in Zod on create
--                                   and update, not by the database, so no
--                                   follow-up tightening migration is planned.
--
--   AralProfile.absenteeismReasons  Section C. Structured multi-select alongside
--                                   the existing "absenteeismFrequency". It does
--                                   NOT replace "absenteeismOtherReason" — that
--                                   free-text column is untouched and keeps its
--                                   current nullability.
--
-- Purely additive: two new types, two new nullable columns. Nothing is dropped,
-- renamed, rewritten or backfilled. Neither ADD COLUMN carries a default, so
-- Postgres records catalog-only changes and takes no table rewrite; the
-- ACCESS EXCLUSIVE lock on "Learner" and "AralProfile" is momentary.
--
-- Existing rows: "nutritionalStatus" is NULL, which is the value the app already
-- expects for a learner profiled before today. "absenteeismReasons" is SQL NULL,
-- which Prisma Client surfaces as an empty array on read — every list column in
-- this schema is written by Prisma, which always sends '{}' rather than NULL, so
-- new and updated rows hold a real empty array from the first write.

-- CreateEnum
CREATE TYPE "NutritionalStatus" AS ENUM ('SEVERELY_WASTED', 'WASTED', 'NORMAL', 'OBESE');

-- CreateEnum
CREATE TYPE "AbsenteeismReason" AS ENUM (
  'FAMILY_EMERGENCY',
  'FINANCIAL_DIFFICULTIES',
  'LACK_OF_TRANSPORTATION',
  'DISTANCE_FROM_SCHOOL',
  'HOUSEHOLD_CHORES',
  'CARING_FOR_FAMILY',
  'BAD_WEATHER',
  'ACADEMIC_DIFFICULTIES',
  'LACK_OF_INTEREST',
  'BULLYING',
  'SCHOOL_CONCERNS',
  'GADGET_SOCIAL_MEDIA',
  'LIVELIHOOD_WORK',
  'FAMILY_RELOCATION',
  'SAFETY_CONCERNS',
  'MEDICAL_APPOINTMENTS',
  'COMPETITIONS_ACTIVITIES',
  'LACK_OF_SUPPLIES'
);

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN "nutritionalStatus" "NutritionalStatus";

-- AlterTable
ALTER TABLE "AralProfile" ADD COLUMN "absenteeismReasons" "AbsenteeismReason"[];

-- No index for either column, deliberately.
--   "Learner"."nutritionalStatus" is form data read with the learner row that is
--   already being fetched by primary key or by an existing schoolId composite; it
--   is not a filter or a join key, and at four values it is too low-cardinality to
--   be selective if it ever became one.
--   "AralProfile"."absenteeismReasons" is reached only through the unique
--   "learnerId", and an array column would need GIN to be searchable at all — not
--   worth the write cost until a report actually filters on it.

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- ALTER TABLE "AralProfile" DROP COLUMN "absenteeismReasons";
-- ALTER TABLE "Learner" DROP COLUMN "nutritionalStatus";
-- DROP TYPE "AbsenteeismReason";
-- DROP TYPE "NutritionalStatus";
--
-- Destructive only of data entered after this migration was applied; no row that
-- exists today depends on either column. Drop the columns before the types.
