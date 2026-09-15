-- The ARAL Profile no longer asks about absenteeism: Weekly Attendance already
-- records every absence, so Section C starts at Letter Recognition.
--
-- Additive only. Drops NOT NULL from "AralProfile"."absenteeismFrequency" so a
-- profile saved from now on can omit it. No row is read, written or deleted:
-- profiles saved before this keep their stored absenteeism answers.
-- "absenteeismOtherReason" is already nullable and "absenteeismReasons" is an
-- array that defaults to empty, so neither needs a change.
--
-- LOCKING: ALTER COLUMN ... DROP NOT NULL is a catalog-only change on
-- PostgreSQL; it takes a brief ACCESS EXCLUSIVE lock and rewrites nothing.
--
-- ROLLBACK: SET NOT NULL again only after backfilling any NULL rows written
-- since, or it fails.

ALTER TABLE "AralProfile" ALTER COLUMN "absenteeismFrequency" DROP NOT NULL;
