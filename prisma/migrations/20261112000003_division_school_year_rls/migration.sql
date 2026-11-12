-- Additive: deny-all RLS on the new DivisionSchoolYear table, like every other
-- table (see prisma/rls-policies.sql). The app connects as the table owner, so
-- this changes nothing for the app; it only shuts PostgREST out.
ALTER TABLE "DivisionSchoolYear" ENABLE ROW LEVEL SECURITY;
