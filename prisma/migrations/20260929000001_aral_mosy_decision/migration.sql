-- MOSY (middle of school year) ARAL decision: one row per learner per school year.
-- Purely additive: two new enum types and one new, empty table. These use CREATE
-- TYPE, not ALTER TYPE ... ADD VALUE, so this same transaction may use the new
-- values in the CHECK. No existing row is touched; no backfill; no tightening follow-up.

CREATE TYPE "AralMosyOutcome" AS ENUM ('MOVE_OUT', 'STAY');

CREATE TYPE "AralMosyMoveOutReason" AS ENUM (
  'IMPROVED_EARLY_GRADES',
  'IMPROVED_UPPER_GRADES',
  'DIAGNOSED_LSEN',
  'RECOMMENDED_LSEN_ASSESSMENT'
);

CREATE TABLE "AralMosyDecision" (
    "id"                  TEXT NOT NULL,
    "schoolId"            TEXT NOT NULL,
    "schoolYearId"        TEXT NOT NULL,
    "learnerId"           TEXT NOT NULL,
    "mosyLevel"           "ReadingProfile" NOT NULL,
    "decision"            "AralMosyOutcome",
    "reason"              "AralMosyMoveOutReason",
    "remarks"             TEXT,
    "tutorId"             TEXT,
    "priorAralEnrolledAt" TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AralMosyDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AralMosyDecision_learnerId_schoolYearId_key"
  ON "AralMosyDecision"("learnerId", "schoolYearId");
CREATE INDEX "AralMosyDecision_schoolYearId_tutorId_idx"
  ON "AralMosyDecision"("schoolYearId", "tutorId");
CREATE INDEX "AralMosyDecision_tutorId_idx" ON "AralMosyDecision"("tutorId");
CREATE INDEX "AralMosyDecision_schoolId_idx" ON "AralMosyDecision"("schoolId");

ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_schoolYearId_fkey"
  FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "Learner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_tutorId_fkey"
  FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A reason is present exactly when the decision is MOVE_OUT. The COALESCE matters:
-- a bare ("decision" = 'MOVE_OUT') = ("reason" IS NOT NULL) evaluates to NULL
-- when decision IS NULL, and a CHECK passes on NULL, so a deferred row could then
-- hold a reason. Here both sides are non-null booleans.
-- Prisma cannot express this; PRESERVE IT when editing AralMosyDecision migrations.
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_reason_iff_move_out"
  CHECK ((COALESCE("decision"::text, '') = 'MOVE_OUT') = ("reason" IS NOT NULL));

-- The remarks cap mirrors the Zod schema (250). PRESERVE IT as above.
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_remarks_length"
  CHECK ("remarks" IS NULL OR char_length("remarks") <= 250);

-- Deny-all to PostgREST, same as every table (prisma/rls-policies.sql).
ALTER TABLE "AralMosyDecision" ENABLE ROW LEVEL SECURITY;

-- Rollback (possible only before any row exists): DROP TABLE "AralMosyDecision";
-- DROP TYPE "AralMosyMoveOutReason"; DROP TYPE "AralMosyOutcome";
-- Rollback is destructive and needs project-owner approval (CLAUDE.md).
