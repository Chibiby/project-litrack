-- Split teacher<->grade/section into two independent axes.
--   Advisory: User.advisorySectionId, 0 or 1 section per teacher. Grade is
--             DERIVED from the section and never stored on the teacher.
--   ARAL:     Learner.aralTeacherId, designated per learner to any teacher,
--             including one with no advisory section.
--
-- Purely additive. No unique index on "User"."advisorySectionId" yet: existing
-- TeacherSection rows allow many teachers per section, so the backfill
-- (20260811000003) must resolve collisions before the unique index
-- (20260811000004) can hold. A plain index lands here so the FK and the
-- backfill's lookups are covered in the meantime.
--
-- "TeacherSection" and "_TeacherGrades" are intentionally left in place. The
-- app still reads them; dropping them is a separate, later migration.

-- CreateEnum
CREATE TYPE "WeeklyWritingLevel" AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_0', 'NA');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "advisorySectionId" TEXT;

-- CreateIndex
CREATE INDEX "User_advisorySectionId_idx" ON "User"("advisorySectionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_advisorySectionId_fkey" FOREIGN KEY ("advisorySectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- A floating learner has no adviser. Existing rows all carry a teacherId and
-- are untouched by dropping the NOT NULL.
-- The "Learner_teacherId_fkey" FK is deliberately NOT altered: it stays
-- ON DELETE RESTRICT. Prisma's implied action for an optional relation is
-- SetNull, so the schema pins `onDelete: Restrict` explicitly to match the
-- database and keep a hard teacher delete blocked rather than silently
-- orphaning learners.
ALTER TABLE "Learner" ALTER COLUMN "teacherId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN "aralTeacherId" TEXT;

-- CreateIndex
CREATE INDEX "Learner_aralTeacherId_idx" ON "Learner"("aralTeacherId");

-- CreateIndex
CREATE INDEX "Learner_schoolId_aralTeacherId_isAralLearner_deletedAt_idx" ON "Learner"("schoolId", "aralTeacherId", "isAralLearner", "deletedAt");

-- AddForeignKey
ALTER TABLE "Learner" ADD CONSTRAINT "Learner_aralTeacherId_fkey" FOREIGN KEY ("aralTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Nullable: existing weekly rows have no writing data.
ALTER TABLE "ReadingLevelRecord" ADD COLUMN "writingLevel" "WeeklyWritingLevel";
