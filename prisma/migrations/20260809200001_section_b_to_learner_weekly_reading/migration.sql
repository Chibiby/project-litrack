-- Move Section B fields from AralProfile → Learner (nullable), then drop from AralProfile.
-- Replace ReadingLevelRecord.monthYear with weekStart (Monday DATE).

-- 1) Learner: add Section B columns
ALTER TABLE "Learner" ADD COLUMN "modeOfTransportation" "ModeOfTransportation";
ALTER TABLE "Learner" ADD COLUMN "distanceHomeToSchool" "DistanceToSchool";
ALTER TABLE "Learner" ADD COLUMN "previousTransfers" "SchoolTransfers";
ALTER TABLE "Learner" ADD COLUMN "transferDetails" TEXT;

-- 2) Copy existing Section B values from AralProfile
UPDATE "Learner" AS l
SET
  "modeOfTransportation" = a."modeOfTransportation",
  "distanceHomeToSchool" = a."distanceHomeToSchool",
  "previousTransfers" = a."previousTransfers",
  "transferDetails" = a."transferDetails"
FROM "AralProfile" AS a
WHERE a."learnerId" = l."id";

-- 3) Drop Section B columns from AralProfile
ALTER TABLE "AralProfile" DROP COLUMN "modeOfTransportation";
ALTER TABLE "AralProfile" DROP COLUMN "distanceHomeToSchool";
ALTER TABLE "AralProfile" DROP COLUMN "previousTransfers";
ALTER TABLE "AralProfile" DROP COLUMN "transferDetails";

-- 4) ReadingLevelRecord: monthYear → weekStart (Monday of week containing YYYY-MM-01)
ALTER TABLE "ReadingLevelRecord" ADD COLUMN "weekStart" DATE;

UPDATE "ReadingLevelRecord"
SET "weekStart" = (date_trunc('week', to_date("monthYear" || '-01', 'YYYY-MM-DD')::timestamp))::date;

-- If any rows somehow collide on (learnerId, weekStart), keep the newest by updatedAt
DELETE FROM "ReadingLevelRecord" AS r
USING "ReadingLevelRecord" AS newer
WHERE r."learnerId" = newer."learnerId"
  AND r."weekStart" = newer."weekStart"
  AND r."id" <> newer."id"
  AND (
    r."updatedAt" < newer."updatedAt"
    OR (r."updatedAt" = newer."updatedAt" AND r."id" < newer."id")
  );

ALTER TABLE "ReadingLevelRecord" ALTER COLUMN "weekStart" SET NOT NULL;

DROP INDEX IF EXISTS "ReadingLevelRecord_learnerId_monthYear_key";
DROP INDEX IF EXISTS "ReadingLevelRecord_monthYear_idx";

ALTER TABLE "ReadingLevelRecord" DROP COLUMN "monthYear";

CREATE UNIQUE INDEX "ReadingLevelRecord_learnerId_weekStart_key" ON "ReadingLevelRecord"("learnerId", "weekStart");
CREATE INDEX "ReadingLevelRecord_weekStart_idx" ON "ReadingLevelRecord"("weekStart");
