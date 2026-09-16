-- Kindergarten competency checklist: one enum, one table.
--
-- "KinderCompetencyRating"  DepEd's three-value scale (Beginning / Developing /
--                           Consistent), stored as full words rather than the
--                           BG/DV/CO shorthand the paper form and UI display.
--
-- "KinderCompetencyRecord"  One row per (learner, school year, competency), with
--                           three nullable per-term rating columns and one shared
--                           optional remark -- not one row per term. The
--                           competency catalog itself is a code constant
--                           (src/lib/terms/kinder-competencies.ts), not a table,
--                           so "competencyKey" is a plain string column with no
--                           FK -- there is no catalog table to point at.
--
-- No "schoolId" column, matching "TermGrade": the write path always starts from
-- one learner, so "learner"."schoolId" is already in hand and tenant scoping
-- goes through the "learnerId"/"schoolYearId" joins, not a denormalized column.
--
-- Purely additive: one new type and one new table. Nothing is dropped,
-- rewritten, or backfilled, and no existing row is touched, so this is safe to
-- apply to a live database and needs no follow-up tightening migration.

-- CreateEnum
CREATE TYPE "KinderCompetencyRating" AS ENUM ('BEGINNING', 'DEVELOPING', 'CONSISTENT');

-- CreateTable
CREATE TABLE "KinderCompetencyRecord" (
    "id"            TEXT NOT NULL,
    "learnerId"     TEXT NOT NULL,
    "schoolYearId"  TEXT NOT NULL,
    "competencyKey" TEXT NOT NULL,
    "t1Rating"      "KinderCompetencyRating",
    "t2Rating"      "KinderCompetencyRating",
    "t3Rating"      "KinderCompetencyRating",
    "remark"        TEXT,
    "recordedById"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KinderCompetencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Per-school-year progress scan (e.g. "N of 62 competencies touched" across
-- the year's Kindergarten roster).
CREATE INDEX "KinderCompetencyRecord_schoolYearId_idx" ON "KinderCompetencyRecord"("schoolYearId");

-- CreateIndex
-- FK lookup side for the "recordedById" SetNull below.
CREATE INDEX "KinderCompetencyRecord_recordedById_idx" ON "KinderCompetencyRecord"("recordedById");

-- CreateIndex
-- The upsert conflict target: one row per learner x school year x competency.
-- Also serves the "whole checklist for one learner in one year" read, since
-- (learnerId, schoolYearId) is this index's leading pair.
CREATE UNIQUE INDEX "KinderCompetencyRecord_learnerId_schoolYearId_competencyKey_key" ON "KinderCompetencyRecord"("learnerId", "schoolYearId", "competencyKey");

-- AddForeignKey
-- Cascade: a deleted learner has no competency records to keep.
ALTER TABLE "KinderCompetencyRecord" ADD CONSTRAINT "KinderCompetencyRecord_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: a record is meaningless without the school year that dates it.
ALTER TABLE "KinderCompetencyRecord" ADD CONSTRAINT "KinderCompetencyRecord_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, nullable: see "Attendance.recordedById" for the full rule -- the
-- rating stays on record after the recording teacher's account is removed.
ALTER TABLE "KinderCompetencyRecord" ADD CONSTRAINT "KinderCompetencyRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
