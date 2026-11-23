-- Cross-school transfers (docs/superpowers/specs/2026-11-23-cross-school-transfers-design.md).
-- Additive only: two new enums, two NotificationType values, one nullable
-- column on Notification, one new table with SQL-only CHECKs, partial unique
-- indexes and RLS. No existing row is read or changed.

-- CreateEnum
CREATE TYPE "SchoolTransferKind" AS ENUM ('LEARNER', 'TEACHER', 'ARAL_VOLUNTEER');

-- CreateEnum
CREATE TYPE "SchoolTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SCHOOL_TRANSFER_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SCHOOL_TRANSFER_DECIDED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "SchoolTransferRequest" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "SchoolTransferKind" NOT NULL,
    "learnerId" TEXT,
    "userId" TEXT,
    "schoolId" TEXT NOT NULL,
    "toSchoolId" TEXT NOT NULL,
    "status" "SchoolTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_toSchoolId_status_createdAt_idx" ON "SchoolTransferRequest"("toSchoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_schoolId_status_createdAt_idx" ON "SchoolTransferRequest"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_learnerId_status_idx" ON "SchoolTransferRequest"("learnerId", "status");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_userId_status_idx" ON "SchoolTransferRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_batchId_idx" ON "SchoolTransferRequest"("batchId");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_requestedById_idx" ON "SchoolTransferRequest"("requestedById");

-- CreateIndex
CREATE INDEX "SchoolTransferRequest_decidedById_idx" ON "SchoolTransferRequest"("decidedById");

-- CreateIndex
CREATE INDEX "Notification_batchId_idx" ON "Notification"("batchId");

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_toSchoolId_fkey" FOREIGN KEY ("toSchoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- SQL-only: exactly one person per row.
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_one_person"
  CHECK ((("learnerId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int) = 1);

-- SQL-only: a transfer goes to a different school.
ALTER TABLE "SchoolTransferRequest" ADD CONSTRAINT "SchoolTransferRequest_schools_differ"
  CHECK ("schoolId" <> "toSchoolId");

-- SQL-only: one PENDING transfer per person. Prisma cannot express a partial
-- unique index (same reason as Enrollment_learner_active_unique).
CREATE UNIQUE INDEX "SchoolTransferRequest_learner_pending_unique"
  ON "SchoolTransferRequest" ("learnerId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "SchoolTransferRequest_user_pending_unique"
  ON "SchoolTransferRequest" ("userId") WHERE "status" = 'PENDING';

-- Defense in depth for direct PostgREST access; app writes go through Prisma.
ALTER TABLE "SchoolTransferRequest" ENABLE ROW LEVEL SECURITY;
