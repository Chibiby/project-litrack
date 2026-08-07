-- CreateEnum
CREATE TYPE "TeacherApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "approvalStatus" "TeacherApprovalStatus",
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_schoolId_approvalStatus_idx" ON "User"("schoolId", "approvalStatus");

-- Backfill: existing active teachers are treated as already approved
UPDATE "User" SET "approvalStatus" = 'APPROVED' WHERE "role" = 'TEACHER' AND "isActive" = true AND "deletedAt" IS NULL;
