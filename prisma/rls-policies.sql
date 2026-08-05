-- =============================================================================
-- PROJECT LITRACK — Row-Level Security policies (defense in depth)
-- =============================================================================
--
-- SECURITY MODEL
-- --------------
-- The Next.js app talks to Postgres primarily through Prisma using a dedicated
-- database role `litrack_app` (connection string in DATABASE_URL). That role
-- does NOT have BYPASSRLS. Therefore:
--
--   1. Enable RLS on every application table.
--   2. GRANT table privileges to `litrack_app`.
--   3. Add PERMISSIVE policies for `litrack_app` so Prisma keeps working.
--      (Alternative: ALTER ROLE litrack_app BYPASSRLS; then skip step 3.)
--
-- Supabase roles:
--   - `anon` / `authenticated`: PostgREST. Do NOT grant SELECT on base
--     School / Learner tables. Authenticated may SELECT their own User row
--     (admin login / session when Prisma is down).
--   - `service_role`: bypasses RLS (Supabase built-in). Used by the admin
--     Supabase client for Auth + emergency PostgREST.
--
-- Public school list (login dropdown): served by a Next.js server action /
-- API route via Prisma — NOT by anon SELECT on "School". If you ever need a
-- PostgREST-public list, use the view `public_schools_list` below (id+name
-- only) — never expose the base table.
--
-- APPLY ORDER (production)
-- ------------------------
--   A. Ensure role `litrack_app` exists and owns/uses the app schema as today.
--   B. `npx prisma migrate deploy` (or mark baseline applied — see README).
--   C. Run THIS file in the Supabase SQL editor (or psql as a privileged role).
--   D. Verify: app pages load; anon PostgREST cannot SELECT "School"/"Learner".
--
-- Do NOT run against a live DB from this agent session — lead applies manually.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Optional public view (id + name only) — NOT granted to anon by default
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_schools_list AS
SELECT id, name
FROM "School"
WHERE "isActive" = true AND "deletedAt" IS NULL;

COMMENT ON VIEW public.public_schools_list IS
  'Narrow school list for potential PostgREST use. Grant SELECT to anon only if needed; prefer the Next.js /api/schools/list route.';

-- -----------------------------------------------------------------------------
-- 1–5) Enable RLS through policies/revokes in one transaction
--     so concurrent Prisma queries cannot see a half-applied state.
-- -----------------------------------------------------------------------------
BEGIN;

-- 1) Enable RLS on all application tables
ALTER TABLE "School"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolYear"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolHeadProfile"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherProfile"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherInvite"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevel"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Learner"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AralProfile"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadingLevelRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_TeacherGrades"     ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (defense in depth on Supabase)
ALTER TABLE "School"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "SchoolYear"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "User"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "SchoolHeadProfile"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "TeacherProfile"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "TeacherInvite"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevel"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "Learner"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "AralProfile"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "Attendance"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "ReadingLevelRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "_TeacherGrades"     FORCE ROW LEVEL SECURITY;

-- 2) Grants for litrack_app (Prisma). Skip if you use BYPASSRLS instead.
-- CREATE ROLE litrack_app LOGIN PASSWORD '...';  -- only if not already created
GRANT USAGE ON SCHEMA public TO litrack_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "School",
  "SchoolYear",
  "User",
  "SchoolHeadProfile",
  "TeacherProfile",
  "TeacherInvite",
  "GradeLevel",
  "Learner",
  "AralProfile",
  "Attendance",
  "ReadingLevelRecord",
  "AuditLog"
TO litrack_app;

-- Join table for Teacher ↔ GradeLevel
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "_TeacherGrades" TO litrack_app;

-- 3) Permissive policies for litrack_app (full access via Prisma)
--    Drop + recreate so re-running this file is idempotent.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'School', 'SchoolYear', 'User', 'SchoolHeadProfile', 'TeacherProfile',
    'TeacherInvite', 'GradeLevel', 'Learner', 'AralProfile', 'Attendance',
    'ReadingLevelRecord', 'AuditLog', '_TeacherGrades'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS litrack_app_all ON %I', t);
    EXECUTE format(
      'CREATE POLICY litrack_app_all ON %I FOR ALL TO litrack_app USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Alternative (instead of step 3 policies):
--   ALTER ROLE litrack_app BYPASSRLS;
-- Only use if your hosting role model requires it; prefer explicit policies.

-- 4) Authenticated: read own User row (PostgREST session / admin login path)
GRANT SELECT ON TABLE "User" TO authenticated;

DROP POLICY IF EXISTS "users_select_self" ON "User";
CREATE POLICY "users_select_self"
  ON "User" FOR SELECT
  TO authenticated
  USING (auth.uid()::text = "authId");

-- 5) Explicitly NO anon / authenticated grants on base School / Learner
--    (Revoke if a previous policy/grant leaked them.)
REVOKE ALL ON TABLE "School" FROM anon;
REVOKE ALL ON TABLE "Learner" FROM anon;
REVOKE ALL ON TABLE "School" FROM authenticated;
REVOKE ALL ON TABLE "Learner" FROM authenticated;

DROP POLICY IF EXISTS "schools_public_list" ON "School";

-- If you later need PostgREST public school names:
--   GRANT SELECT ON public.public_schools_list TO anon, authenticated;
-- Prefer keeping school listing in the Next.js server action instead.

COMMIT;
