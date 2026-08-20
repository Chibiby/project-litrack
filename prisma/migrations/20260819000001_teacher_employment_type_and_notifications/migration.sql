-- Two additions behind teacher-side ARAL designation.
--
--   TeacherProfile.employmentType  DepEd plantilla or not. Nullable on purpose:
--                                  every profile completed before this column
--                                  existed never answered the question, and a
--                                  default would make those rows claim an answer
--                                  nobody gave. Display only — it is shown as a
--                                  chip when designating an ARAL tutor and never
--                                  narrows who is eligible, because a non-DepEd
--                                  teacher is a valid tutor.
--
--   Notification                   In-app message addressed to one user, with its
--                                  own read state. The shell bell previously
--                                  rendered values derived from dashboard numbers,
--                                  which can carry neither "who did this to me" nor
--                                  "I have seen it".
--
-- Purely additive: two new types, one new nullable column, one new table. Nothing
-- is dropped, rewritten, or backfilled, so this is safe to apply to a live database
-- and needs no follow-up tightening migration.
--
-- No advisory backfill here. 20260811000003 already populated
-- "User"."advisorySectionId" from "TeacherSection", and setTeacherAdvisory is the
-- only writer of those rows and sets the pointer in the same transaction, so no
-- drift can have accumulated since.

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('DEPED_PLANTILLA', 'NON_DEPED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ARAL_ASSIGNED');

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN "employmentType" "EmploymentType";

-- CreateTable
-- "learnerIds" holds ids only. The sentence the recipient reads is composed at
-- read time from the current learner rows, so no learner PII is duplicated here
-- and a renamed or removed learner cannot leave stale text in the feed. One row
-- is written per action, not per learner.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "learnerIds" TEXT[],
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The feed read: one recipient's unread rows, newest first.
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_schoolId_createdAt_idx" ON "Notification"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: a deleted recipient has no feed to keep.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Set null: removing the actor must not delete the recipient's history with them.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
