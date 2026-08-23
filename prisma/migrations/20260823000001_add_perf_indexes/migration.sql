-- R6 / Phase 4 — additive read-path indexes (12 indexes across 9 tables).
--
-- ADDITIVE ONLY. No DROP, no ALTER, no column/type/constraint change. Every
-- statement is a CREATE INDEX, so no existing row is rewritten or invalidated
-- and nothing here can disturb the two hand-written SQL invariants that live in
-- other migration files (Enrollment's partial unique index in
-- 20260806000001_foundation_models, TermGrade_score_range in 20260822000001_term_grades).
--
-- TWO APPLY PATHS — read this before running anything:
--
--   * Every environment EXCEPT the existing production database (CI, fresh
--     clones, local dev, any new Supabase project) takes this file the normal
--     way, via `npx prisma migrate deploy`. Nothing special to do.
--
--   * The EXISTING PRODUCTION database takes `prisma/concurrent-indexes.sql`
--     instead, then `npx prisma migrate resolve --applied 20260823000001_add_perf_indexes`
--     to record this migration as applied without re-running the DDL.
--
--     Why: `CREATE INDEX` (without CONCURRENTLY) takes an ACCESS EXCLUSIVE lock
--     that blocks every read and write on the table for the duration of the
--     build. On a populated Learner/Attendance table that is user-visible
--     downtime. `CREATE INDEX CONCURRENTLY` takes only SHARE UPDATE EXCLUSIVE,
--     so reads and writes continue — but it CANNOT run inside a transaction
--     block, and `prisma migrate deploy` wraps every migration file in one.
--     Hence the separate script. See docs/migrate-checklist.md, section (b1).
--
-- IF NOT EXISTS is deliberate. It makes this file idempotent, which is what
-- makes the two paths safe to mix: a database that already received the
-- CONCURRENTLY form will not fail here. That protection depends entirely on the
-- index NAMES being identical in both files. They are the names
-- `prisma migrate diff` generates from prisma/schema.prisma — do not rename one
-- without renaming the other, or IF NOT EXISTS silently stops protecting anything.

-- CreateIndex
-- R6 #4 — deleteSection's `enrollment.updateMany({ where: { sectionId } })`;
-- [gradeLevelId, sectionId] cannot serve it because sectionId is not leading.
CREATE INDEX IF NOT EXISTS "Enrollment_sectionId_idx" ON "Enrollment"("sectionId");

-- CreateIndex
-- R6 #5 — [schoolId, schoolYearId] does not lead with schoolYearId.
CREATE INDEX IF NOT EXISTS "Enrollment_schoolYearId_idx" ON "Enrollment"("schoolYearId");

-- CreateIndex
-- R6 #2 — grade-scoped ARAL listings ordered by name.
CREATE INDEX IF NOT EXISTS "Learner_gradeLevelId_isAralLearner_fullName_idx" ON "Learner"("gradeLevelId", "isAralLearner", "fullName");

-- CreateIndex
-- R6 #4 — deleteSection's `learner.updateMany({ where: { sectionId } })`.
CREATE INDEX IF NOT EXISTS "Learner_sectionId_idx" ON "Learner"("sectionId");

-- CreateIndex
-- R6 #6 — school-scoped name-ordered listings and the learner-search ILIKE.
-- Not redundant with the #2 index above: same trailing sort column, different
-- lead column, neither subsumes the other.
CREATE INDEX IF NOT EXISTS "Learner_schoolId_fullName_idx" ON "Learner"("schoolId", "fullName");

-- CreateIndex
-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX IF NOT EXISTS "Announcement_authorId_idx" ON "Announcement"("authorId");

-- CreateIndex
-- R6 #3 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX IF NOT EXISTS "Attendance_recordedById_idx" ON "Attendance"("recordedById");

-- CreateIndex
-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX IF NOT EXISTS "AttendanceDayMeta_recordedById_idx" ON "AttendanceDayMeta"("recordedById");

-- CreateIndex
-- R6 #3 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX IF NOT EXISTS "ReadingLevelRecord_recordedById_idx" ON "ReadingLevelRecord"("recordedById");

-- CreateIndex
-- R6 #5 — FK-enforcement lookup side (implicit RESTRICT).
CREATE INDEX IF NOT EXISTS "TermGrade_recordedById_idx" ON "TermGrade"("recordedById");

-- CreateIndex
-- R6 #5 — lookup side of this FK's SetNull action.
CREATE INDEX IF NOT EXISTS "Notification_actorId_idx" ON "Notification"("actorId");

-- CreateIndex
-- R6 #1 — the cross-tenant Super Admin audit top-N and the dashboard's
-- `timestamp >= $1` range scan. Ascending on purpose: PostgreSQL scans a b-tree
-- backwards at equal cost, so DESC would buy nothing.
CREATE INDEX IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
