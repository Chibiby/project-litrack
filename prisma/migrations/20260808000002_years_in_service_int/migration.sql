-- Convert YearsInService enum → INTEGER (0–70) on both profile tables.
-- Legacy buckets map to the lower bound of each range.

ALTER TABLE "SchoolHeadProfile" ADD COLUMN "yearsInServiceInt" INTEGER;

UPDATE "SchoolHeadProfile" SET "yearsInServiceInt" = CASE
  WHEN "yearsInService"::text = 'Y0_3' THEN 0
  WHEN "yearsInService"::text = 'Y4_10' THEN 4
  WHEN "yearsInService"::text = 'Y11_20' THEN 11
  WHEN "yearsInService"::text = 'Y21_PLUS' THEN 21
  ELSE 0
END;

ALTER TABLE "SchoolHeadProfile" DROP COLUMN "yearsInService";
ALTER TABLE "SchoolHeadProfile" RENAME COLUMN "yearsInServiceInt" TO "yearsInService";
ALTER TABLE "SchoolHeadProfile" ALTER COLUMN "yearsInService" SET NOT NULL;

ALTER TABLE "TeacherProfile" ADD COLUMN "yearsInServiceInt" INTEGER;

UPDATE "TeacherProfile" SET "yearsInServiceInt" = CASE
  WHEN "yearsInService"::text = 'Y0_3' THEN 0
  WHEN "yearsInService"::text = 'Y4_10' THEN 4
  WHEN "yearsInService"::text = 'Y11_20' THEN 11
  WHEN "yearsInService"::text = 'Y21_PLUS' THEN 21
  ELSE 0
END;

ALTER TABLE "TeacherProfile" DROP COLUMN "yearsInService";
ALTER TABLE "TeacherProfile" RENAME COLUMN "yearsInServiceInt" TO "yearsInService";
ALTER TABLE "TeacherProfile" ALTER COLUMN "yearsInService" SET NOT NULL;

DROP TYPE "YearsInService";
