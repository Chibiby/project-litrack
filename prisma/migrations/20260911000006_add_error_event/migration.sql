-- Error events: one row per server-side failure worth a Super Admin's attention.
--
-- PURELY ADDITIVE, NO BACKFILL
-- ---------------------------
-- One new table and four indexes. No existing table, column, constraint, index
-- or enum is altered, and nothing is rewritten. Every existing row is untouched,
-- and there is nothing to backfill: the table records events that happen after
-- it exists, and an empty table is the truthful record of a history nobody was
-- keeping yet. Rolling back is `DROP TABLE "ErrorEvent"`, which loses only rows
-- this migration itself made possible.
--
-- SAFE IN EITHER ORDER RELATIVE TO THE DEPLOY
-- -------------------------------------------
-- Unlike `20260911000002_release_channel`, this adds no column to a table that
-- existing code already selects, so neither order breaks anything. Applied
-- first, the table simply sits empty until `src/lib/errors/report.ts` ships.
-- Deployed first, `report.ts` fails to write and — by design, since a reporter
-- that throws would replace the original error with its own — the failure is
-- swallowed and logged, so the app keeps serving; those events are lost, which
-- is the only reason to prefer applying this first.
--
-- NO FOREIGN KEYS, DELIBERATELY
-- -----------------------------
-- `userId` and `schoolId` are plain nullable text, not references. A failure
-- must be recordable precisely when the rows it concerns are broken, missing or
-- mid-rollback, and an FK would make the act of recording the failure fail too.
-- It also means deleting a school does not cascade its error history away before
-- retention has had it: that history is an operational record, not tenant data.
-- Same shape as `School.createdById` and `AuditLog.userId`.
--
-- RETENTION, NOT GROWTH
-- ---------------------
-- This is the only table in the schema that grows with incidents rather than
-- with the school roll, so nothing here is kept forever: the daily cron deletes
-- rows older than ERROR_EVENT_RETENTION_DAYS (default 30). The `createdAt` index
-- is what makes that delete cheap, as well as what the admin list sorts on.
--
-- RLS is not set here. As with every other table, the enable line lives in
-- `prisma/rls-policies.sql`, run separately after deploy. `ErrorEvent` gets the
-- deny-all treatment and no policies: Super-Admin-only, read through Prisma on
-- the service role, which bypasses RLS.

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "routeType" TEXT,
    "method" TEXT,
    "userId" TEXT,
    "schoolId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorEvent_createdAt_idx" ON "ErrorEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_ref_idx" ON "ErrorEvent"("ref");

-- CreateIndex
CREATE INDEX "ErrorEvent_code_createdAt_idx" ON "ErrorEvent"("code", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_schoolId_createdAt_idx" ON "ErrorEvent"("schoolId", "createdAt");
