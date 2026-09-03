-- Support assistant: tickets to the division admin, and the scoped, expiring
-- unlock grants a resolved ticket can issue.
--
-- Purely additive: two new tables, three new enums, two new NotificationType
-- values and one nullable column on Notification. Nothing is dropped, nothing
-- is backfilled, and no existing row changes — so this is safe to apply while
-- the app is serving.
--
-- `ALTER TYPE ... ADD VALUE` runs before any statement that uses the new values
-- (none here do), which is what keeps it legal inside Prisma's migration
-- transaction on PostgreSQL 12+.

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('UNLOCK_REQUEST', 'SYSTEM_ASSISTANCE', 'BUG_REPORT', 'ACCOUNT_ACCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "UnlockScope" AS ENUM ('ARAL_WEEKLY_ATTENDANCE', 'TERM_GRADES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_RESOLVED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "ticketId" TEXT;

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pageUrl" TEXT,
    "requestedScope" "UnlockScope",
    "requestedTargetKey" TEXT,
    "resolverId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnlockGrant" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "UnlockScope" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "ticketId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnlockGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_schoolId_createdAt_idx" ON "SupportTicket"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_requesterId_createdAt_idx" ON "SupportTicket"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_resolverId_idx" ON "SupportTicket"("resolverId");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockGrant_ticketId_key" ON "UnlockGrant"("ticketId");

-- CreateIndex
CREATE INDEX "UnlockGrant_userId_scope_expiresAt_idx" ON "UnlockGrant"("userId", "scope", "expiresAt");

-- CreateIndex
CREATE INDEX "UnlockGrant_schoolId_expiresAt_idx" ON "UnlockGrant"("schoolId", "expiresAt");

-- CreateIndex
CREATE INDEX "UnlockGrant_grantedById_idx" ON "UnlockGrant"("grantedById");

-- CreateIndex
CREATE INDEX "UnlockGrant_revokedById_idx" ON "UnlockGrant"("revokedById");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockGrant_userId_scope_targetKey_key" ON "UnlockGrant"("userId", "scope", "targetKey");

-- CreateIndex
CREATE INDEX "Notification_ticketId_idx" ON "Notification"("ticketId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

