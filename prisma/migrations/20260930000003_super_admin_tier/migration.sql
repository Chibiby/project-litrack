-- Split Super Admin into Developer Admin and Division Admin.
-- Category: additive (new enum type, nullable column) plus a bounded backfill
-- that only fills nulls on four named Super Admin rows. No row loses data.
-- A null on a Super Admin reads as DIVISION in app code (least privilege).

CREATE TYPE "AdminTier" AS ENUM ('DEVELOPER', 'DIVISION');

ALTER TABLE "User" ADD COLUMN "adminTier" "AdminTier";

UPDATE "User" SET "adminTier" = 'DEVELOPER'
WHERE "role" = 'SUPER_ADMIN' AND "adminTier" IS NULL
  AND "username" IN ('brandan', 'dante', 'claude');

UPDATE "User" SET "adminTier" = 'DIVISION'
WHERE "role" = 'SUPER_ADMIN' AND "adminTier" IS NULL
  AND "username" = 'john';

-- Rollback: ALTER TABLE "User" DROP COLUMN "adminTier"; DROP TYPE "AdminTier";
-- Destructive, needs project-owner approval (CLAUDE.md).
