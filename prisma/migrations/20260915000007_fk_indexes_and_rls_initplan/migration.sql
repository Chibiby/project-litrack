-- Supabase performance advisor findings, 2026-09-15.
--
-- 1. Unindexed foreign keys (lint 0001). Each index is the lookup side of an
--    FK's ON DELETE action, so deleting the parent row no longer scans the
--    child table. TermSubject's composite (gradeLevelId, schoolId) FK is
--    already served by "TermSubject_gradeLevelId_deletedAt_position_idx",
--    which leads with gradeLevelId, so only the schoolId FK gets an index.
--
-- 2. Auth RLS initplan (lint 0003). "users_select_self" called auth.uid() once
--    per row. Wrapping it in a scalar sub-select lets Postgres evaluate it once
--    per statement. Same predicate, same role, same command: who can read which
--    row does not change. App traffic uses the service-role connection and
--    bypasses RLS; this only affects direct PostgREST reads.
--
-- Additive only. No row is read, written or deleted.
--
-- LOCKING: plain CREATE INDEX takes a SHARE lock that blocks writes to the
-- table while it builds. The four tables are small (TermSubject ~16k rows,
-- Notification ~7k, TeacherInvite and the policy table far fewer), so each
-- build takes well under a second. DROP/CREATE POLICY runs in the same
-- transaction, so no moment exists without the policy.
--
-- ROLLBACK:
--   DROP INDEX "Notification_channelId_idx";
--   DROP INDEX "TeacherInvite_gradeLevelId_idx";
--   DROP INDEX "TeacherInvite_sectionId_idx";
--   DROP INDEX "TermSubject_schoolId_idx";
--   and recreate the policy with USING ((auth.uid())::text = "authId").

CREATE INDEX IF NOT EXISTS "Notification_channelId_idx" ON "Notification"("channelId");
CREATE INDEX IF NOT EXISTS "TeacherInvite_gradeLevelId_idx" ON "TeacherInvite"("gradeLevelId");
CREATE INDEX IF NOT EXISTS "TeacherInvite_sectionId_idx" ON "TeacherInvite"("sectionId");
CREATE INDEX IF NOT EXISTS "TermSubject_schoolId_idx" ON "TermSubject"("schoolId");

DROP POLICY IF EXISTS "users_select_self" ON "User";
CREATE POLICY "users_select_self"
  ON "User" FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid())::text = "authId");
