-- PROJECT LITRACK — concurrent index builds for the EXISTING production database
-- R6 / Phase 4. 12 indexes across 9 tables.
--
-- Run this with psql on DIRECT_URL (port 5432 / session mode) BEFORE marking the
-- migration applied. Sibling in spirit to prisma/rls-policies.sql: an out-of-band
-- SQL file a human applies, not something `migrate deploy` picks up.
--
-- ============================================================================
-- WHO RUNS THIS, AND WHO DOES NOT
-- ============================================================================
--
--   * ONLY the existing, populated production database needs this file.
--
--   * Every other environment — CI, fresh clones, local dev, a brand-new
--     Supabase project — takes `npx prisma migrate deploy`, which applies
--     prisma/migrations/20260823000001_add_perf_indexes/migration.sql. Do NOT
--     run this file there; on an empty or small table a plain CREATE INDEX is
--     instant and the normal path also does the migration bookkeeping for you.
--
-- ============================================================================
-- WHY A SEPARATE FILE EXISTS AT ALL
-- ============================================================================
--
-- Plain `CREATE INDEX` takes an ACCESS EXCLUSIVE lock on the table for the whole
-- build: every read and every write on that table blocks until it finishes. On a
-- populated "Learner" or "Attendance" that is user-visible downtime.
--
-- `CREATE INDEX CONCURRENTLY` takes only SHARE UPDATE EXCLUSIVE, so reads and
-- writes continue throughout. It costs two table passes instead of one and is
-- therefore slower in wall-clock terms — that is the trade, and it is the right
-- one here.
--
-- The catch: CREATE INDEX CONCURRENTLY **cannot run inside a transaction block**,
-- and `prisma migrate deploy` wraps every migration file in one. So this form
-- cannot live in the migration. Hence two files.
--
-- Do NOT wrap this file in BEGIN/COMMIT. Do not run it through a tool that opens
-- an implicit transaction. psql without -1 / --single-transaction is correct;
-- each statement below autocommits on its own. The Supabase SQL Editor is NOT a
-- safe way to run this file — it can wrap statements in a transaction, which
-- makes every CONCURRENTLY statement fail with 25001.
--
-- ============================================================================
-- APPLY ORDER
-- ============================================================================
--
--   1. Take a backup / confirm the PITR window (docs/migrate-checklist.md (a)).
--
--   2. Confirm what is pending, read-only:
--        npx prisma migrate status
--
--   3. Run this file with psql on the DIRECT (non-pooler) URL, port 5432:
--        psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/concurrent-indexes.sql
--      NOT the transaction pooler on 6543.
--
--   4. Verify every index below is valid (query in the VERIFY section at the
--      bottom of this file). Do this before step 5 — step 5 tells Prisma the
--      DDL is done, so a silently-invalid index would go unnoticed.
--
--   5. Record the migration as applied WITHOUT re-running its SQL:
--        npx prisma migrate resolve --applied 20260823000001_add_perf_indexes
--
--      Skipping step 5 leaves the migration pending forever: the next
--      `migrate deploy` re-runs it. (It would in fact succeed here, because the
--      migration uses IF NOT EXISTS — but it would take ACCESS EXCLUSIVE locks
--      to do nothing, which is exactly the downtime this file avoided. Do step 5.)
--
--   6. `npx prisma migrate status` again — expect no pending migrations.
--
-- ============================================================================
-- IF A BUILD FAILS
-- ============================================================================
--
-- A failed or interrupted CREATE INDEX CONCURRENTLY leaves behind an **INVALID**
-- index. An invalid index is not used by the planner (so you get no benefit) but
-- IS still maintained on every write (so you pay the full write cost). It must be
-- dropped before retrying:
--
--   DROP INDEX CONCURRENTLY IF EXISTS "<index_name>";
--
-- then re-run that one statement. Find them with the VERIFY query below.
--
-- This is the one DROP in this file's documentation and it is scoped to an index
-- this file created moments earlier. It is not a licence to drop anything else.
--
-- ============================================================================
-- NAME PARITY — DO NOT BREAK THIS
-- ============================================================================
--
-- Every index name below is byte-identical to the name in
-- prisma/migrations/20260823000001_add_perf_indexes/migration.sql, and both were
-- taken from `prisma migrate diff --script` output generated from
-- prisma/schema.prisma. That is what makes the migration's IF NOT EXISTS a real
-- safety net rather than decoration: after this file runs, the migration becomes
-- a no-op on this database. Rename an index in one file and you must rename it
-- in the other and in schema.prisma (via @@index ordering), or the two apply
-- paths diverge and you get duplicate indexes under different names.

-- R6 #4 — deleteSection's `enrollment.updateMany({ where: { sectionId } })`;
-- [gradeLevelId, sectionId] cannot serve it because sectionId is not leading.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Enrollment_sectionId_idx" ON "Enrollment"("sectionId");

-- R6 #5 — [schoolId, schoolYearId] does not lead with schoolYearId.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Enrollment_schoolYearId_idx" ON "Enrollment"("schoolYearId");

-- R6 #2 — grade-scoped ARAL listings ordered by name.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Learner_gradeLevelId_isAralLearner_fullName_idx" ON "Learner"("gradeLevelId", "isAralLearner", "fullName");

-- R6 #4 — deleteSection's `learner.updateMany({ where: { sectionId } })`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Learner_sectionId_idx" ON "Learner"("sectionId");

-- R6 #6 — school-scoped name-ordered listings and the learner-search ILIKE.
-- Not redundant with the #2 index above: same trailing sort column, different
-- lead column, neither subsumes the other.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Learner_schoolId_fullName_idx" ON "Learner"("schoolId", "fullName");

-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Announcement_authorId_idx" ON "Announcement"("authorId");

-- R6 #3 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attendance_recordedById_idx" ON "Attendance"("recordedById");

-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AttendanceDayMeta_recordedById_idx" ON "AttendanceDayMeta"("recordedById");

-- R6 #3 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ReadingLevelRecord_recordedById_idx" ON "ReadingLevelRecord"("recordedById");

-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TermGrade_recordedById_idx" ON "TermGrade"("recordedById");

-- R6 #5 — lookup side of this FK's SetNull action.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_actorId_idx" ON "Notification"("actorId");

-- R6 #1 — the cross-tenant Super Admin audit top-N and the dashboard's
-- `timestamp >= $1` range scan. Ascending on purpose: PostgreSQL scans a b-tree
-- backwards at equal cost, so DESC would buy nothing.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- ============================================================================
-- VERIFY — run this after the statements above, BEFORE `migrate resolve`
-- ============================================================================
--
-- Expect 12 rows, every one with valid = true.
--
--   SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready
--   FROM pg_class c
--   JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE c.relname IN (
--     'Enrollment_sectionId_idx',
--     'Enrollment_schoolYearId_idx',
--     'Learner_gradeLevelId_isAralLearner_fullName_idx',
--     'Learner_sectionId_idx',
--     'Learner_schoolId_fullName_idx',
--     'Announcement_authorId_idx',
--     'Attendance_recordedById_idx',
--     'AttendanceDayMeta_recordedById_idx',
--     'ReadingLevelRecord_recordedById_idx',
--     'TermGrade_recordedById_idx',
--     'Notification_actorId_idx',
--     'AuditLog_timestamp_idx'
--   )
--   ORDER BY c.relname;
--
-- Fewer than 12 rows  => a statement did not run. Re-run that one.
-- valid = false       => that build failed. DROP INDEX CONCURRENTLY it (see
--                        "IF A BUILD FAILS" above), then re-run that statement.
--
-- Any invalid index left in place is the worst of both worlds: unused by the
-- planner, still maintained on every write.
