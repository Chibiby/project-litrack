-- Per-term grade sheet for the ARAL module: two enums and one table.
--
--   TermPeriod    The three grading terms. The calendar window each term covers is
--                 DERIVED from the active "SchoolYear"."startDate" at read time, so
--                 there is no term table, no seeding, and no cron job to advance.
--
--   LearningArea  The eight learning areas on the sheet. Deliberately a NEW type
--                 rather than a reuse of "Subject": that one is a dead
--                 teacher-survey artifact ('ARALPAN', 'ABM', 'TECHVOC') retained
--                 only for existing profile rows, and a live feature must not
--                 depend on a set that is scheduled for removal.
--
--   TermGrade     One learner's grade in one learning area for one term of one
--                 school year. Corrected by overwrite, never soft-deleted, hence
--                 no "deletedAt" column.
--
-- "schoolYearId" is NOT NULL because a term enum carries no year on its own.
-- Without it, next year's FIRST-term English would collide with this year's on the
-- unique index below.
--
-- No "schoolId" column, matching "ReadingLevelRecord". Tenancy is enforced by the
-- learner query being scoped to the caller's school, not by a column here.
--
-- General Average is never stored -- it is computed on read from the filled cells,
-- so it cannot drift away from them.
--
-- Purely additive: two new types and one new table. Nothing is dropped, rewritten,
-- or backfilled, and no existing row is touched, so this is safe to apply to a live
-- database and needs no follow-up tightening migration.

-- CreateEnum
CREATE TYPE "TermPeriod" AS ENUM ('FIRST', 'SECOND', 'THIRD');

-- CreateEnum
CREATE TYPE "LearningArea" AS ENUM ('ENGLISH', 'FILIPINO', 'MATHEMATICS', 'SCIENCE', 'ARALING_PANLIPUNAN', 'EDUKASYON_SA_PAGPAPAKATAO', 'MAPEH', 'TLE');

-- CreateTable
CREATE TABLE "TermGrade" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "term" "TermPeriod" NOT NULL,
    "subject" "LearningArea" NOT NULL,
    "score" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One score per learner per learning area per term per year. This is also the
-- conflict target the save action upserts on; a cleared cell is a row deletion,
-- because "score" is NOT NULL.
CREATE UNIQUE INDEX "TermGrade_learnerId_schoolYearId_term_subject_key" ON "TermGrade"("learnerId", "schoolYearId", "term", "subject");

-- CreateIndex
-- The sheet read: one term of one school year, before the per-learner join.
CREATE INDEX "TermGrade_schoolYearId_term_idx" ON "TermGrade"("schoolYearId", "term");

-- AddForeignKey
-- Cascade: a deleted learner has no grades to keep.
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: a grade is meaningless without the school year that dates it.
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Restrict: the recorder is the accountability trail for the score, so a User row
-- referenced here cannot be hard-deleted out from under it. Accounts are removed by
-- soft delete ("deletedAt") anyway.
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Range CHECK: a DepEd quarterly grade is a whole number from 60 to 100.
-- Prisma's schema language cannot express CHECK constraints, so this is raw SQL
-- and is invisible to `prisma migrate diff` -- preserve it when editing TermGrade
-- migrations. Same reason and same care as "Enrollment_learner_active_unique".
-- Named outside Prisma's own constraint conventions to signal it is SQL-only.
--
-- 60, not 75: 75 is DepEd's passing mark, not its floor. A 75 minimum would make a
-- failing learner unrecordable and push teachers to enter a false 75.
--
-- "score" is NOT NULL, so BETWEEN cannot be short-circuited by a NULL write; the
-- Zod schema enforces the same range at the edge, and this is the backstop.
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_score_range" CHECK ("score" BETWEEN 60 AND 100);
