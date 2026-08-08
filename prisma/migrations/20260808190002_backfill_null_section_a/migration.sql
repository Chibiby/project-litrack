-- One-time data backfill (M1 Grade+Sections restructure).
-- For each (schoolId, gradeLevelId) with active learners that have sectionId IS NULL:
--   1) Ensure a Section named 'A' exists (undelete soft-deleted 'A', or insert a new one)
--   2) Point those learners at that section
--   3) Point ACTIVE enrollments for those learners in that grade (sectionId IS NULL) at that section
-- Idempotent: re-running only no-ops when nothing remains NULL.
-- Relies on Section @@unique([gradeLevelId, name]) → "Section_gradeLevelId_name_key".

WITH need AS (
  SELECT DISTINCT "schoolId", "gradeLevelId"
  FROM "Learner"
  WHERE "sectionId" IS NULL
    AND "deletedAt" IS NULL
),
ensured AS (
  INSERT INTO "Section" ("id", "schoolId", "gradeLevelId", "name")
  SELECT gen_random_uuid(), n."schoolId", n."gradeLevelId", 'A'
  FROM need n
  ON CONFLICT ("gradeLevelId", "name") DO UPDATE
    SET "deletedAt" = NULL
  RETURNING "id", "schoolId", "gradeLevelId"
),
updated_learners AS (
  UPDATE "Learner" l
  SET "sectionId" = e."id"
  FROM ensured e
  WHERE l."schoolId" = e."schoolId"
    AND l."gradeLevelId" = e."gradeLevelId"
    AND l."sectionId" IS NULL
    AND l."deletedAt" IS NULL
  RETURNING l."id" AS "learnerId", l."gradeLevelId", e."id" AS "sectionId"
)
UPDATE "Enrollment" en
SET "sectionId" = ul."sectionId"
FROM updated_learners ul
WHERE en."learnerId" = ul."learnerId"
  AND en."gradeLevelId" = ul."gradeLevelId"
  AND en."status" = 'ACTIVE'
  AND en."sectionId" IS NULL;
