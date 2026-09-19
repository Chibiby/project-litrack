-- Additive, nullable: no backfill. Chooses the School Head dashboard banner art.
-- Deliberately never tightened to NOT NULL; the field is permanently optional.
ALTER TABLE "SchoolHeadProfile" ADD COLUMN "gender" "Gender";
