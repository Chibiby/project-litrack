-- Global Archive (spec task T1) — make the nine "who recorded this" foreign keys
-- nullable with ON DELETE SET NULL, and add the two archive-list indexes.
--
-- ============================================================================
-- WHAT THIS DOES AND WHY
-- ============================================================================
--
-- PART A. Nine columns that pointed at "User" with ON DELETE RESTRICT become
-- nullable with ON DELETE SET NULL:
--
--   Attendance.recordedById          AttendanceDayMeta.recordedById
--   ReadingLevelRecord.recordedById  TermGrade.recordedById
--   Announcement.authorId            Report.createdById
--   UnlockGrant.grantedById          SchoolUnlockGrant.grantedById
--   TermWindowOverride.setById
--
-- RESTRICT made a permanent delete of any teacher who had ever recorded anything
-- impossible at the storage layer. The project owner's decision is that a
-- permanent delete of a teacher must ALWAYS succeed. The rows stay; they lose
-- only their pointer to the person.
--
-- THE ACCEPTED COST, STATED SO NOBODY DISCOVERS IT LATER: attendance marks,
-- reading assessments and term grades taken by a purged teacher keep existing
-- but can no longer name who took them. That is intended, not a regression. NULL
-- in these columns means "the recorder was permanently deleted" — it never means
-- "not recorded yet", because the row's existence is what records the event.
--
-- PART B. Two plain b-tree indexes for the /admin/archive read, which is global
-- and cross-tenant:
--
--   User    WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC
--   Learner WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC
--
-- No existing index serves either: every candidate composite leads with
-- "schoolId" (or "gradeLevelId"), which this query does not supply. Today it is
-- a sequential scan plus an external sort on an uncached, force-dynamic page.
--
-- ============================================================================
-- EFFECT ON EXISTING ROWS: NONE. THIS IS A LOOSENING CHANGE.
-- ============================================================================
--
-- NO BACKFILL IS NEEDED AND NO EXISTING ROW CHANGES. Every statement below
-- either widens what a column may hold (DROP NOT NULL), widens what a delete may
-- do (RESTRICT -> SET NULL), or adds an index. Nothing narrows, nothing rewrites
-- a row, nothing sets a value. Every one of the nine columns is fully populated
-- today and stays fully populated after this runs; a NULL can only appear later,
-- when a User row is actually deleted.
--
-- BUT IT IS NOT REVERSIBLE WITHOUT A BACKFILL, and whoever applies this is
-- committing to that. The moment the first teacher is purged, NULLs exist in
-- these columns and there is no information anywhere from which to reconstruct
-- who the recorder was — the User row is gone and AuditLog stores ids, not the
-- per-row attribution. Restoring NOT NULL after that point would require
-- inventing a value or deleting the affected learner data. Reverting is
-- therefore only clean BEFORE any purge has run; after that it needs a
-- point-in-time restore. See the rollback note in docs/migrations.md.
--
-- ============================================================================
-- LOCKING — READ BEFORE CHOOSING A WINDOW
-- ============================================================================
--
-- Each of the nine tables takes a brief ACCESS EXCLUSIVE lock (blocking every
-- read and write on that table) for its DROP CONSTRAINT and its ALTER COLUMN
-- ... DROP NOT NULL. Both are catalog-only and instant in themselves — they do
-- not rewrite the table.
--
-- Re-adding each foreign key then takes SHARE ROW EXCLUSIVE on the child table
-- AND on "User", and validates by scanning the child table. Reads continue;
-- writes to that table wait. On a populated "Attendance" that scan is the
-- longest part of this migration.
--
-- `prisma migrate deploy` wraps this whole file in ONE transaction, so the locks
-- ACCUMULATE and are all held until it commits. In particular "User" is locked
-- for the duration, which means sign-in blocks for the duration. APPLY THIS IN A
-- LOW-TRAFFIC WINDOW. It is short, but it is not zero.
--
-- ============================================================================
-- PART B HAS A SECOND ARTIFACT — AND ONE IMPORTANT DIFFERENCE
-- ============================================================================
--
-- "User" and "Learner" are populated in production, so the two CREATE INDEX
-- statements below also exist in `prisma/concurrent-indexes.sql` in their
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS form, under byte-identical names
-- ("User_deletedAt_idx", "Learner_deletedAt_idx"). Build them there FIRST with
-- psql on DIRECT_URL, and the IF NOT EXISTS below turns them into no-ops here,
-- so this migration does not hold ACCESS EXCLUSIVE on "Learner" while an index
-- builds. See docs/migrations.md, "Concurrent index builds".
--
-- ***  DO NOT run `prisma migrate resolve --applied` for this migration.  ***
--
-- That step belongs to the INDEX-ONLY carve-out in docs/migrate-checklist.md
-- (b1), and this migration is not index-only: resolving it would mark it done
-- while silently skipping all of Part A, leaving nine RESTRICT foreign keys in
-- place against a schema.prisma that says SET NULL. The concurrent file only
-- pre-builds the indexes; `prisma migrate deploy` still applies this file.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — the nine foreign keys, one block per table:
--          DROP CONSTRAINT -> DROP NOT NULL -> ADD CONSTRAINT (SET NULL)
-- ─────────────────────────────────────────────────────────────────────────────

-- Attendance.recordedById — learner attendance this teacher marked.
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_recordedById_fkey";
ALTER TABLE "Attendance" ALTER COLUMN "recordedById" DROP NOT NULL;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AttendanceDayMeta.recordedById — grade-level holiday flags.
ALTER TABLE "AttendanceDayMeta" DROP CONSTRAINT "AttendanceDayMeta_recordedById_fkey";
ALTER TABLE "AttendanceDayMeta" ALTER COLUMN "recordedById" DROP NOT NULL;
ALTER TABLE "AttendanceDayMeta" ADD CONSTRAINT "AttendanceDayMeta_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ReadingLevelRecord.recordedById — learner reading assessments.
ALTER TABLE "ReadingLevelRecord" DROP CONSTRAINT "ReadingLevelRecord_recordedById_fkey";
ALTER TABLE "ReadingLevelRecord" ALTER COLUMN "recordedById" DROP NOT NULL;
ALTER TABLE "ReadingLevelRecord" ADD CONSTRAINT "ReadingLevelRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TermGrade.recordedById — learner term grades. The TermGrade_score_range CHECK
-- from 20260822000001_term_grades is untouched: it constrains "score", not this.
ALTER TABLE "TermGrade" DROP CONSTRAINT "TermGrade_recordedById_fkey";
ALTER TABLE "TermGrade" ALTER COLUMN "recordedById" DROP NOT NULL;
ALTER TABLE "TermGrade" ADD CONSTRAINT "TermGrade_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Announcement.authorId — school content others read.
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_authorId_fkey";
ALTER TABLE "Announcement" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Report.createdById — Reports Hub history rows.
ALTER TABLE "Report" DROP CONSTRAINT "Report_createdById_fkey";
ALTER TABLE "Report" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- UnlockGrant.grantedById — grants this person issued.
ALTER TABLE "UnlockGrant" DROP CONSTRAINT "UnlockGrant_grantedById_fkey";
ALTER TABLE "UnlockGrant" ALTER COLUMN "grantedById" DROP NOT NULL;
ALTER TABLE "UnlockGrant" ADD CONSTRAINT "UnlockGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SchoolUnlockGrant.grantedById — school-wide grants this person issued. The
-- only one of the nine whose RESTRICT was written explicitly rather than
-- inherited as Prisma's implicit action (20260911000014_school_unlock_grant).
ALTER TABLE "SchoolUnlockGrant" DROP CONSTRAINT "SchoolUnlockGrant_grantedById_fkey";
ALTER TABLE "SchoolUnlockGrant" ALTER COLUMN "grantedById" DROP NOT NULL;
ALTER TABLE "SchoolUnlockGrant" ADD CONSTRAINT "SchoolUnlockGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TermWindowOverride.setById — term deadlines this person set.
ALTER TABLE "TermWindowOverride" DROP CONSTRAINT "TermWindowOverride_setById_fkey";
ALTER TABLE "TermWindowOverride" ALTER COLUMN "setById" DROP NOT NULL;
ALTER TABLE "TermWindowOverride" ADD CONSTRAINT "TermWindowOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — the two /admin/archive indexes.
--
-- IF NOT EXISTS is what lets the concurrent pre-build in
-- prisma/concurrent-indexes.sql make these no-ops on production. It checks only
-- that the NAME is taken, so it will also skip an INVALID index left by a failed
-- CONCURRENTLY build and report success. Verify validity there; do not infer it
-- from a green deploy here.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Learner_deletedAt_idx" ON "Learner"("deletedAt");
