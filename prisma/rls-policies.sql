-- PROJECT LITRACK - Supabase Row-Level Security policies
-- Run this in the Supabase SQL editor AFTER `prisma migrate deploy`.
--
-- Strategy: All app data access goes through Next.js server actions using the
-- Prisma client (service role). RLS here is a defense-in-depth layer that
-- protects against direct PostgREST/anon access. Anon role is denied; service
-- role bypasses RLS automatically.

-- Enable RLS on all application tables
ALTER TABLE "School"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolYear"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolHeadProfile"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherProfile"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherInvite"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevel"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Section"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherSection"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Learner"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AralProfile"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadingLevelRecord"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"             ENABLE ROW LEVEL SECURITY;

-- Deny-all default for anon. (No policies = no rows visible to anon.)
-- Service role automatically bypasses RLS.

-- Optional: allow authenticated users to read their own User row
-- (only used if you add direct PostgREST calls from the client; otherwise leave commented).
-- CREATE POLICY "users_select_self"
--   ON "User" FOR SELECT
--   TO authenticated
--   USING (auth.uid()::text = "authId");

-- Public read of (id, name) for the school dropdown on the login page.
-- This is intentionally narrow: anon can list active schools by id+name only.
DROP POLICY IF EXISTS "schools_public_list" ON "School";
CREATE POLICY "schools_public_list"
  ON "School" FOR SELECT
  TO anon, authenticated
  USING ("isActive" = true AND "deletedAt" IS NULL);

-- Note: even with the policy above, the app uses a server action that returns
-- only id and name (see /api/schools/list).
