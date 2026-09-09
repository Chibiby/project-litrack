-- ===========================================================================
-- Self-declared ARAL volunteer at registration
-- ===========================================================================
-- Adds one boolean to "User", recording that the person ticked
-- "I am a Non-DepEd ARAL Volunteer" on the create-account form.
--
-- The declaration cannot live on "TeacherProfile": that row is only written
-- when the profiling wizard is submitted, and its NOT NULL columns make a stub
-- row impossible. So the intent is parked here, read once by the wizard to
-- seed and lock the designation, and never consulted again.
--
-- This column is NOT the authority on who is a volunteer. That remains
-- "TeacherProfile"."designation" = 'Non-DepEd ARAL Volunteer', which the person
-- can still change later from Settings -> Profile.
--
-- Additive and non-destructive: NOT NULL with a default, so every existing row
-- gets false without a backfill pass. Postgres 11+ writes the default into the
-- catalog rather than rewriting the table, so this is a metadata-only change
-- and does not lock "User" for the length of a rewrite.
-- ===========================================================================

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "registeredAsAralVolunteer" BOOLEAN NOT NULL DEFAULT false;

-- No index. The column is read only by primary key, when the profiling wizard
-- loads the signed-in user's own row.

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- ALTER TABLE "User" DROP COLUMN "registeredAsAralVolunteer";
--
-- Safe to drop: nothing else references it, and losing it only means a
-- volunteer who has not yet finished profiling has to pick their own
-- designation in the wizard, exactly as before this migration.
