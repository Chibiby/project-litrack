-- Grade 1-3 reading bands "Developing" and "Transitioning", split out of the
-- combined "Developing or Transitioning" band (INSTRUCTIONAL_DEVELOPING).
-- Existing Grade 1-3 INSTRUCTIONAL_DEVELOPING rows are left as they are: the
-- app shows them as "Developing or Transitioning - needs update" until a
-- teacher re-picks. G4+ keep INSTRUCTIONAL_DEVELOPING as "Instructional".
-- Category: additive (two enum values). No backfill.
-- Kept alone in its migration so the new values are committed before any later
-- migration could reference them.

-- BEFORE 'INDEPENDENT_GRADE_READY': reading-level sorts order by the enum's
-- ordinal, so the new bands must sit between Developing and Grade-level Ready.
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'DEVELOPING' BEFORE 'INDEPENDENT_GRADE_READY';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'TRANSITIONING' BEFORE 'INDEPENDENT_GRADE_READY';

-- Rollback: Postgres cannot drop an enum value. Rebuilding the type is
-- destructive and needs project-owner approval (CLAUDE.md).
