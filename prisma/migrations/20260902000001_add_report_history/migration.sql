-- Report history for the Reports Hub — two enums, one table, two indexes.
--
-- ADDITIVE ONLY. No DROP, no ALTER of an existing column, no backfill. Nothing
-- here touches an existing row, so it cannot disturb the two hand-written SQL
-- invariants that live in other migration files (Enrollment's partial unique
-- index in 20260806000001_foundation_models, TermGrade_score_range in
-- 20260822000001_term_grades).
--
-- APPLY PATH: the normal one. `npx prisma migrate deploy`.
--
-- Unlike 20260823000001_add_perf_indexes, this needs no CONCURRENTLY carve-out:
-- CREATE TABLE takes its lock on a relation that does not exist yet, and the two
-- indexes are created on that same empty table, so there is nothing to block and
-- no rows to scan. See docs/migrate-checklist.md.
--
-- The report FILE is deliberately not stored. A row records what was asked for
-- and replays it on demand, which is why there is no bytea column here and why
-- this table holds no learner PII at rest.

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM (
  'ATTENDANCE',
  'READING_LEVEL',
  'TERM_GRADES',
  'TEACHER_SUMMARY',
  'CLASS_ROSTER',
  'CUSTOM'
);

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('EXCEL', 'PDF');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "name" TEXT NOT NULL,
    "scopeLabel" TEXT,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The Recent Reports query: one school, one author, newest first.
CREATE INDEX "Report_schoolId_createdById_createdAt_idx" ON "Report"("schoolId", "createdById", "createdAt");

-- CreateIndex
-- FK-enforcement lookup side (implicit RESTRICT), matching the R6 #3/#5 rule
-- established in 20260823000001_add_perf_indexes.
CREATE INDEX "Report_createdById_idx" ON "Report"("createdById");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT, not CASCADE: deleting the author must not silently erase the record
-- that a report over learner data was produced.
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
