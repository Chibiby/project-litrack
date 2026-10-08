-- Learner section transfers: a teacher's request to move a learner to another
-- section of the same grade (teacher requests only; a School Head's direct
-- transfer writes no row here).
-- See docs/specs/learner-section-transfers.md.
--
-- Additive: one new enum, one new table, indexes, foreign keys, two SQL-only
-- CHECKs, one SQL-only partial unique index and RLS. No existing row is read,
-- changed or backfilled.

-- CreateEnum
CREATE TYPE "SectionTransferRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SectionTransferRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "requestedById" TEXT,
    "fromSectionId" TEXT NOT NULL,
    "toSectionId" TEXT NOT NULL,
    "status" "SectionTransferRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionTransferRequest_schoolId_status_createdAt_idx" ON "SectionTransferRequest"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SectionTransferRequest_learnerId_status_idx" ON "SectionTransferRequest"("learnerId", "status");

-- CreateIndex
CREATE INDEX "SectionTransferRequest_requestedById_status_idx" ON "SectionTransferRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "SectionTransferRequest_decidedById_idx" ON "SectionTransferRequest"("decidedById");

-- CreateIndex
CREATE INDEX "SectionTransferRequest_fromSectionId_idx" ON "SectionTransferRequest"("fromSectionId");

-- CreateIndex
CREATE INDEX "SectionTransferRequest_toSectionId_idx" ON "SectionTransferRequest"("toSectionId");

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_fromSectionId_fkey" FOREIGN KEY ("fromSectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_toSectionId_fkey" FOREIGN KEY ("toSectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SQL-only: at most one PENDING request per learner. Prisma's schema language
-- cannot express a partial unique index (same reason as
-- Enrollment_learner_active_unique). "learnerId" is NOT NULL, so NULL cannot
-- defeat it.
CREATE UNIQUE INDEX "SectionTransferRequest_learner_pending_unique"
  ON "SectionTransferRequest"("learnerId") WHERE "status" = 'PENDING';

-- SQL-only CHECKs. A request is decided exactly when it has left PENDING, and
-- a transfer must change section.
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_decided_iff_not_pending"
  CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL));
ALTER TABLE "SectionTransferRequest" ADD CONSTRAINT "SectionTransferRequest_sections_differ"
  CHECK ("fromSectionId" <> "toSectionId");

-- Deny-all through PostgREST, as for every other table (20261003000002). The
-- app reads and writes only through Prisma on the service connection.
ALTER TABLE "SectionTransferRequest" ENABLE ROW LEVEL SECURITY;
