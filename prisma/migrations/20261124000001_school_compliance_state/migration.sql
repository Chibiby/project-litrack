-- Full Compliance change log (docs/superpowers/specs/2026-11-24-full-compliance-design.md).
-- Additive only: one new enum and two new tables. No existing row is read or changed.

-- CreateEnum
CREATE TYPE "ComplianceBaseStatus" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'NOT_EVALUATED');

-- CreateTable
CREATE TABLE "SchoolComplianceState" (
    "schoolId" TEXT NOT NULL,
    "status" "ComplianceBaseStatus" NOT NULL,
    "compliantSince" TEXT,
    "lastCheckedOn" TEXT NOT NULL,
    "flags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolComplianceState_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolComplianceEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "fromStatus" "ComplianceBaseStatus",
    "toStatus" "ComplianceBaseStatus" NOT NULL,
    "flags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolComplianceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolComplianceEvent_schoolId_dateKey_idx" ON "SchoolComplianceEvent"("schoolId", "dateKey");

-- CreateIndex
CREATE INDEX "SchoolComplianceEvent_dateKey_idx" ON "SchoolComplianceEvent"("dateKey");

-- AddForeignKey
ALTER TABLE "SchoolComplianceState" ADD CONSTRAINT "SchoolComplianceState_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolComplianceEvent" ADD CONSTRAINT "SchoolComplianceEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Defense in depth for direct PostgREST access; app writes go through Prisma.
ALTER TABLE "SchoolComplianceState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolComplianceEvent" ENABLE ROW LEVEL SECURITY;
