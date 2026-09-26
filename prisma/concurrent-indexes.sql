-- PROJECT LITRACK — concurrent index builds for the EXISTING production database
-- 17 indexes across 10 tables, in four batches:
--
--   BATCH 1 (12 indexes) — R6 / Phase 4, for migration
--     20260823000001_add_perf_indexes.
--   BATCH 2 (2 indexes)  — the /admin/archive lists, for migration
--     20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes.
--   BATCH 3 (2 indexes)  — the term-subjects ON CONFLICT target and its FK
--     lookup side on "TermGrade", for migration
--     20260915000001_term_subject_table.
--   BATCH 4 (1 index)    — the Notification retention purge's "createdAt"
--     range scan, for migration
--     20260926000001_notification_created_at_index.
--
-- THE BATCHES HAVE DIFFERENT BOOKKEEPING. Batch 1's migration is index-only, so
-- it takes the `migrate resolve --applied` carve-out. Batch 2's migration also
-- changes nine foreign keys, so it MUST go through `migrate deploy` and must NEVER
-- be resolved. Batch 3's migration also creates "TermSubject", adds
-- "TermGrade"."termSubjectId" and its FK, and backfills every existing row — also
-- not index-only, so it too MUST go through `migrate deploy` and must NEVER be
-- resolved. Batch 4's migration is index-only again, like batch 1, so it takes
-- the `migrate resolve --applied` carve-out too. Step 5 below spells this out;
-- getting it wrong silently skips the non-index half of whichever batch it is
-- applied to. Running this file is safe and idempotent regardless of which
-- batches a given database has already taken.
--
-- Run this with psql on DIRECT_URL (port 5432 / session mode) BEFORE the
-- bookkeeping / deploy step. Sibling in spirit to prisma/rls-policies.sql: an
-- out-of-band SQL file a human applies, not something `migrate deploy` picks up.
--
-- ============================================================================
-- WHO RUNS THIS, AND WHO DOES NOT
-- ============================================================================
--
--   * ONLY the existing, populated production database needs this file.
--
--   * Every other environment — CI, fresh clones, local dev, a brand-new
--     Supabase project — takes `npx prisma migrate deploy`, which applies
--     prisma/migrations/20260823000001_add_perf_indexes/migration.sql,
--     .../20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes/
--     migration.sql, and .../20260915000001_term_subject_table/migration.sql.
--     Do NOT run this file there; on an empty or small table a plain CREATE
--     INDEX is instant and the normal path also does the migration
--     bookkeeping for you.
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
--   4. Read the validity table this file prints at the end (the VERIFY section is
--      a live SELECT, so it runs as part of step 3). Expect 16 rows, all valid.
--      Check it before step 5 — step 5 tells Prisma the DDL is done, so a
--      silently-invalid index would go unnoticed from then on. A zero exit code
--      is NOT sufficient evidence; look at the rows.
--
--      Fewer than 16 rows on a database that has only ever taken batch 1 (or
--      batches 1-2) is NOT a partial success — it means this file is newer than
--      the last run. Re-run it; the batches already taken skip and the new one
--      builds.
--
--      BUT: if step 3 exited NON-ZERO, no table was printed at all. ON_ERROR_STOP=1
--      aborts psql at the first error, and the VERIFY SELECT is the last statement
--      in the file, so the run died before reaching it. That is neither of the two
--      cases in the VERIFY notes below — it is no result set at all. Run the VERIFY
--      SELECT at the end of this file by hand to see how far the build got, then
--      read the error psql printed, because the causes have OPPOSITE remedies:
--
--        25001 ("cannot run inside a transaction block") => nothing was built. You
--          ran the file through something that opens an implicit transaction — the
--          Supabase SQL Editor, psql -1 / --single-transaction, or a ~/.psqlrc with
--          \set AUTOCOMMIT off (psql -f still reads it; the command above has no
--          -X). There is no invalid index to drop and re-running as-is reproduces
--          the same failure. Go back to the warning at the top of this file and to
--          step 3 above, fix how you are invoking it, then start over.
--        any other error => read it against the hand-run's output. A valid = f row
--          is a real build failure: go to "IF A BUILD FAILS". ZERO rows means the
--          statement never started, so fix what the error names (host, database,
--          role, file path) and start over.
--
--      ZERO rows means nothing was built and there is nothing to drop, whatever the
--      error was. Conversely, a zero exit with no table in front of you means
--      you are not looking at the end of the output, not that the query is missing.
--
--   5. Bookkeeping — DIFFERENT PER BATCH. Read all four bullets.
--
--      BATCH 1 — record the migration as applied WITHOUT re-running its SQL:
--        npx prisma migrate resolve --applied 20260823000001_add_perf_indexes
--
--      Skipping this leaves the migration pending forever: the next
--      `migrate deploy` re-runs it. (It would in fact succeed, because the
--      migration uses IF NOT EXISTS — but it would take ACCESS EXCLUSIVE locks
--      to do nothing, which is exactly the downtime this file avoided.)
--
--      BATCH 2 — *** DO NOT RESOLVE. Run `npx prisma migrate deploy`. ***
--
--      20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes is
--      NOT index-only: alongside these two indexes it drops NOT NULL on nine
--      columns and rewrites nine foreign keys from ON DELETE RESTRICT to
--      ON DELETE SET NULL. `resolve --applied` writes the bookkeeping row and
--      runs no SQL, so resolving it would mark it done while silently skipping
--      every one of those changes — leaving the database enforcing RESTRICT
--      against a schema.prisma that promises SET NULL, and a teacher purge
--      failing with P2003 for reasons nothing in the code explains.
--
--      `migrate deploy` is correct and cheap here precisely because this file
--      already built the two indexes: the migration's CREATE INDEX IF NOT EXISTS
--      statements become no-ops, so the deploy does only the foreign-key work.
--      Read that migration's header before running it — it takes brief ACCESS
--      EXCLUSIVE locks on nine tables and on "User", inside one transaction, so
--      it wants a low-traffic window.
--
--      BATCH 3 — *** DO NOT RESOLVE. Run `npx prisma migrate deploy`. ***
--
--      20260915000001_term_subject_table is NOT index-only either: alongside
--      these two indexes it creates "TermSubject", adds nullable
--      "TermGrade"."termSubjectId" with its FK, seeds 8 default subjects per
--      "GradeLevel", and backfills every existing "TermGrade" row. Resolving
--      it would mark it done while silently skipping all of that, leaving
--      "TermGrade"."termSubjectId" NULL everywhere and no "TermSubject" table
--      for the app to read — a P2021/P2022 outage the moment the term-subjects
--      code deploys. Running this file first only pre-builds the two indexes;
--      `prisma migrate deploy` still applies the rest of that migration.
--
--      BATCH 4 — record the migration as applied WITHOUT re-running its SQL,
--      same as batch 1:
--        npx prisma migrate resolve --applied 20260926000001_notification_created_at_index
--
--      20260926000001_notification_created_at_index is index-only — one
--      `CREATE INDEX` on "Notification", nothing else. Skipping this step
--      leaves the migration pending forever, same consequence as batch 1.
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
-- DROP INDEX CONCURRENTLY also cannot run inside a transaction block, for the same
-- reason CREATE INDEX CONCURRENTLY cannot. Run it with psql on DIRECT_URL, not in
-- the Supabase SQL Editor and not under `psql -1` / --single-transaction.
--
-- Then RE-RUN THIS WHOLE FILE. Do not re-run just the one failed statement: this
-- file is invoked with ON_ERROR_STOP=1, so a failure aborts the run and every
-- statement AFTER the failing one never executed either. Re-running the whole file
-- is correct and cheap because every statement is IF NOT EXISTS-guarded — the
-- indexes that already built successfully are skipped.
--
-- Beware the trap in the other direction: IF NOT EXISTS only checks that the NAME
-- is taken, so it will happily skip an INVALID index and report success. Drop the
-- invalid ones FIRST, then re-run. Otherwise `migrate deploy` and this file will
-- both report success over a permanently broken index.
--
-- This is the one DROP in this file's documentation and it is scoped to an index
-- this file created moments earlier. It is not a licence to drop anything else.
--
-- ============================================================================
-- NAME PARITY — DO NOT BREAK THIS
-- ============================================================================
--
-- Every index name below is byte-identical to the name in its migration —
-- batch 1 in prisma/migrations/20260823000001_add_perf_indexes/migration.sql,
-- batch 2 in prisma/migrations/
-- 20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes/
-- migration.sql, batch 3 in
-- prisma/migrations/20260915000001_term_subject_table/migration.sql, batch 4
-- in prisma/migrations/20260926000001_notification_created_at_index/
-- migration.sql. Batches 1-3's names were taken from `prisma migrate diff
-- --script` output generated from prisma/schema.prisma. Batch 4's could not
-- be generated the same way — `prisma migrate diff` needs a reachable shadow
-- database, which this offline authoring step does not have — so it instead
-- follows the same `<Model>_<field>_idx` convention as the sibling
-- single-column indexes above (e.g. "Notification_actorId_idx",
-- "AuditLog_timestamp_idx"). Whoever applies this should confirm the name
-- with a real `prisma migrate diff --script` run before running this file.
-- That naming discipline is what makes each migration's IF NOT EXISTS a
-- real safety net rather than decoration: after this file runs, the matching
-- statements in the migration become no-ops on this database. Rename an index
-- in one file and you must rename it in the other and in schema.prisma (via
-- @@index/@@unique ordering), or the two apply paths diverge and you get
-- duplicate indexes under different names.

-- ============================================================================
-- BATCH 1 — R6 / Phase 4 (migration 20260823000001_add_perf_indexes)
-- ============================================================================

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
-- BATCH 2 — /admin/archive lists (migration
-- 20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes)
--
-- These two are the reason to run this file again on a database that already
-- took batch 1. Batch 1's statements above skip harmlessly.
--
-- REMINDER: after this file, batch 2 needs `prisma migrate deploy`, NOT
-- `migrate resolve --applied`. Its migration also rewrites nine foreign keys.
-- ============================================================================

-- The global, cross-tenant archive read:
--   WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC
-- No existing index serves it — User's [schoolId, role, deletedAt] and Learner's
-- composites all lead with a column that query does not supply. Ascending on
-- purpose: PostgreSQL scans a b-tree backwards at equal cost, so DESC buys
-- nothing (same reasoning as AuditLog_timestamp_idx above).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- Twin of the above. "Learner" is the larger table and the one that most needs
-- CONCURRENTLY rather than the migration's plain CREATE INDEX.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Learner_deletedAt_idx" ON "Learner"("deletedAt");

-- ============================================================================
-- BATCH 3 — term-subjects (migration 20260915000001_term_subject_table)
--
-- These two are the reason to run this file again on a database that already
-- took batches 1-2. Their statements above skip harmlessly.
--
-- REMINDER: after this file, batch 3 needs `prisma migrate deploy`, NOT
-- `migrate resolve --applied`. Its migration also creates "TermSubject",
-- alters "TermGrade" and backfills every existing row — see the note in
-- APPLY ORDER step 5 above.
-- ============================================================================

-- The new ON CONFLICT target `saveTermGrades` upserts on: one row per
-- learner/year/term/subject. "TermGrade" already needed a CONCURRENTLY build
-- once before (TermGrade_recordedById_idx, batch 1), so this one gets the
-- same treatment rather than an ACCESS EXCLUSIVE build on a populated table.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "TermGrade_learnerId_schoolYearId_term_termSubjectId_key" ON "TermGrade"("learnerId", "schoolYearId", "term", "termSubjectId");

-- FK lookup side for the new "termSubjectId" -> "TermSubject" relation, and
-- what `saveTermGrades`' per-subject clear and the reports grouping query
-- filter on.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TermGrade_termSubjectId_idx" ON "TermGrade"("termSubjectId");

-- ============================================================================
-- BATCH 4 — Notification retention purge (migration
-- 20260926000001_notification_created_at_index)
--
-- This is the reason to run this file again on a database that already took
-- batches 1-3. Their statements above skip harmlessly.
--
-- REMINDER: after this file, batch 4 needs
-- `migrate resolve --applied 20260926000001_notification_created_at_index`,
-- same as batch 1 — this migration is index-only.
-- ============================================================================

-- The daily retention purge (src/lib/retention/purge.ts): both
-- purgeExpiredNotifications (`WHERE "createdAt" < $cutoff`) and
-- purgeReadNotifications (`WHERE "readAt" IS NOT NULL AND "createdAt" <
-- $cutoff`) need an index leading with "createdAt". Neither existing
-- Notification index qualifies — [recipientId, readAt, createdAt] and
-- [schoolId, createdAt] both need a different column first — so both purge
-- queries were doing a full sequential scan of a table every notification
-- ever sent writes into.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- ============================================================================
-- VERIFY — runs automatically as part of this file, BEFORE `migrate resolve`
-- ============================================================================
--
-- This is a LIVE statement, not a commented snippet, so
-- `psql -f prisma/concurrent-indexes.sql` prints the validity table as part of the
-- same command that built the indexes. The docs call this check mandatory, so it
-- should not depend on remembering to paste a second query.
--
-- It is strictly READ-ONLY (a SELECT against the pg_class / pg_index catalogs) and
-- cannot itself fail under ON_ERROR_STOP=1: a name that is missing simply does not
-- come back as a row. It can, however, be SKIPPED — see the third case below.
--
-- READ THE OUTPUT. Do not proceed to `migrate resolve` on a green exit code alone.
--
--   Expect exactly 17 rows, every one with valid = t.
--
--   Fewer than 17 rows => that index was never built. Re-run this whole file
--                         (every statement is IF NOT EXISTS-guarded). Exactly 12
--                         rows (batch 1 only), 14 rows (batches 1-2), or 16 rows
--                         (batches 1-3) is the expected state of a database
--                         that last ran an earlier version of this file — the
--                         same remedy applies.
--   valid = f          => that build FAILED. Drop it with
--                         DROP INDEX CONCURRENTLY (see "IF A BUILD FAILS" above,
--                         and note it needs psql for the same transaction
--                         reason), then re-run this whole file.
--   NO table printed   => psql aborted before reaching this statement, because
--     and non-zero exit   ON_ERROR_STOP=1 stops at the first error and this is the
--                         last statement in the file. Not "fewer than 12 rows" —
--                         zero rows, because the query never ran. Run it by hand to
--                         see how far the build got, then branch on the error psql
--                         printed:
--                           25001 => nothing was built; you ran the file inside an
--                             implicit transaction (SQL Editor, psql -1, AUTOCOMMIT
--                             off). Nothing to drop; fix the invocation per step 3
--                             and the header warning, then start over.
--                           anything else => a valid = f row is a real build
--                             failure, "IF A BUILD FAILS"; zero rows means the
--                             statement never started, so fix what the error names
--                             (host, database, role, file path) and start over.
--                         Zero rows from the hand-run means nothing was built and
--                         there is nothing to drop, whatever the error was.
--
-- An invalid index left in place is the worst of both worlds: ignored by the
-- planner, still maintained on every write — and IF NOT EXISTS will skip over it
-- forever, so nothing will tell you again.

SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname IN (
  'Enrollment_sectionId_idx',
  'Enrollment_schoolYearId_idx',
  'Learner_gradeLevelId_isAralLearner_fullName_idx',
  'Learner_sectionId_idx',
  'Learner_schoolId_fullName_idx',
  'Announcement_authorId_idx',
  'Attendance_recordedById_idx',
  'AttendanceDayMeta_recordedById_idx',
  'ReadingLevelRecord_recordedById_idx',
  'TermGrade_recordedById_idx',
  'Notification_actorId_idx',
  'AuditLog_timestamp_idx',
  'User_deletedAt_idx',
  'Learner_deletedAt_idx',
  'TermGrade_learnerId_schoolYearId_term_termSubjectId_key',
  'TermGrade_termSubjectId_idx',
  'Notification_createdAt_idx'
)
ORDER BY c.relname;
