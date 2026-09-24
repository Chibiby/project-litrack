-- Which districts a DISTRICT_ADMIN supervises.
--
-- "district" is the exact, canonical "School.district" string -- a join by
-- value, not a foreign key, because "School.district" is free text
-- (docs/specs/district-admin.md section 13, alternative A). Composite PK
-- ("userId","district"): all NOT NULL, so the uniqueness this gives cannot
-- be defeated by NULLs, the same reasoning as TeacherSection's PK.
--
-- Purely additive: one new, empty table. Nothing is dropped, rewritten, or
-- backfilled, and no existing row anywhere is touched, so this is safe to
-- apply to a live database and needs no follow-up tightening migration.

-- CreateTable
CREATE TABLE "DistrictAdminAssignment" (
    "userId"      TEXT NOT NULL,
    "district"    TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "DistrictAdminAssignment_pkey" PRIMARY KEY ("userId","district")
);

-- CreateIndex
-- Not a duplicate of the PK's leading "userId": this serves "who supervises
-- district X?" (the script's existing-assignment lookup and the "no district
-- admin" compliance card), which the PK's column order cannot serve.
CREATE INDEX "DistrictAdminAssignment_district_idx" ON "DistrictAdminAssignment"("district");

-- "district" is canonical: non-empty, and equal to itself with runs of
-- whitespace collapsed to one space and outer whitespace trimmed -- the same
-- expression 20260908000003_normalize_existing_data applied to
-- "School"."district" itself. Prisma's schema language cannot express a CHECK
-- constraint, so, like "User_avatarPath_shape" and "TermGrade_score_range"
-- before it, this lives only here. PRESERVE IT when editing
-- DistrictAdminAssignment migrations (docs/migrations.md).
ALTER TABLE "DistrictAdminAssignment" ADD CONSTRAINT "DistrictAdminAssignment_district_canonical"
  CHECK (
    "district" <> ''
    AND "district" = btrim(regexp_replace("district", '\s+', ' ', 'g'))
  );

-- AddForeignKey
-- Cascade: a removed user keeps no assignment rows to grant scope with.
ALTER TABLE "DistrictAdminAssignment" ADD CONSTRAINT "DistrictAdminAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-all RLS, same as every other table in prisma/rls-policies.sql: every
-- read and write goes through Prisma on the service role, which bypasses
-- RLS. This line plus the matching ENABLE line in rls-policies.sql are both
-- required -- see tests/unit/rls-coverage.test.ts.
ALTER TABLE "DistrictAdminAssignment" ENABLE ROW LEVEL SECURITY;
