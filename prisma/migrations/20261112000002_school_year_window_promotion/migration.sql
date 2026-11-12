-- Additive only: two enums, one enum value, one table, nullable columns.

-- CreateEnum
CREATE TYPE "EnrollmentOutcome" AS ENUM ('PROMOTED', 'RETAINED');

-- CreateEnum
CREATE TYPE "LearnerRemovalReason" AS ENUM ('NLPA', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'DUPLICATE', 'OTHER');

-- AlterEnum
ALTER TYPE "AralMosyMoveOutReason" ADD VALUE 'NLPA';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "outcome" "EnrollmentOutcome",
ADD COLUMN "outcomeAt" TIMESTAMP(3),
ADD COLUMN "outcomeById" TEXT;

-- AlterTable
ALTER TABLE "Learner" ADD COLUMN "removalReason" "LearnerRemovalReason",
ADD COLUMN "removalNote" TEXT;

-- CreateTable
CREATE TABLE "DivisionSchoolYear" (
    "label" TEXT NOT NULL,
    "activeStart" TIMESTAMP(3) NOT NULL,
    "activeEnd" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionSchoolYear_pkey" PRIMARY KEY ("label")
);

-- Masterlist lookup: promoted/retained enrollments per school.
CREATE INDEX "Enrollment_schoolId_outcome_idx" ON "Enrollment"("schoolId", "outcome");
