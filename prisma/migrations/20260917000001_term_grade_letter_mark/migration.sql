-- Grade 1 End of Terms reports record a letter mark instead of a numeric
-- score. One enum, two loosened/added columns on the existing "TermGrade"
-- table, and one SQL-only CHECK.
--
--   TermMark        DepEd's Grade 1 rating scale: Advancing, Benchmarking,
--                    Connecting, Developing, Emerging. Stored as full words,
--                    matching this schema's other rating enums
--                    (KinderCompetencyRating, WeeklyWordRecognitionLevel).
--
--   TermGrade.score  Loosened to nullable. A row now holds EITHER a numeric
--                    score OR a letter mark, never both, never neither.
--
--   TermGrade.mark   New nullable column carrying the letter mark.
--
-- "TermGrade_score_range" (from 20260822000001_term_grades) is
-- `CHECK ("score" BETWEEN 60 AND 100)`. A BETWEEN against a NULL evaluates to
-- NULL, which Postgres treats as satisfied for CHECK purposes -- so that
-- constraint alone would happily accept a row with neither "score" nor
-- "mark". The new xor CHECK below is what actually closes that gap; the
-- range CHECK still does its original job of bounding a non-NULL score.
--
-- Every existing row has a "score" and no "mark", so both CHECKs pass at
-- migration time with no backfill: xor("score" IS NULL, "mark" IS NULL) is
-- true for every row already in the table (score present, mark absent).
--
-- This migration does NOT restrict letter marks to Grade 1. "TermGrade" has
-- no direct column naming a grade level -- that lives across
-- "TermSubject" -> "GradeLevel", a cross-table hop a single-table CHECK
-- cannot express. The Grade-1-only rule is enforced in the save action
-- (validated against `GradeLevel.type`), not here.
--
-- Deploy order: apply this BEFORE the code that writes "mark" ships. It is
-- additive and inert on its own -- old code keeps reading/writing "score"
-- exactly as before, and an old Prisma client never selects a column it
-- does not know about. The direction that is NOT safe is a same-or-later
-- CODE ROLLBACK: once any row has been saved with "mark" set (and "score"
-- NULL), reverting the app to a build compiled against `score Int`
-- (non-nullable) makes that row's "score" read as `null` where the old
-- code's types promise `number` -- a runtime type mismatch, not a caught
-- error. Fix forward instead of rolling the code back once a mark exists.
CREATE TYPE "TermMark" AS ENUM ('ADVANCING', 'BENCHMARKING', 'CONNECTING', 'DEVELOPING', 'EMERGING');

-- AlterTable
ALTER TABLE "TermGrade" ADD COLUMN "mark" "TermMark";
ALTER TABLE "TermGrade" ALTER COLUMN "score" DROP NOT NULL;

-- SQL-only CHECK, like "TermGrade_score_range" above it: Prisma's schema
-- language cannot express CHECK constraints. Preserve both when editing
-- TermGrade migrations (docs/migrations.md).
--
-- Exactly one of "score" / "mark" per row -- the boolean XOR reads as
-- "these two nullness-checks disagree", i.e. exactly one of the two columns
-- is NULL.
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_score_xor_mark"
  CHECK (("score" IS NULL) <> ("mark" IS NULL));
