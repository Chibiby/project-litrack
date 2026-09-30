-- MOSY: target level for the "Improved to <level>" reason.
-- Category: additive (one nullable column, one CHECK). Split from
-- 20260930000001 so the new enum value is committed first; the CHECK compares
-- via ::text and does not reference the new enum literal anyway.
-- Existing rows all have improvedToLevel NULL and reason NULL or a legacy value,
-- so the CHECK holds for every one of them. No backfill, no tightening follow-up.

ALTER TABLE "AralMosyDecision" ADD COLUMN "improvedToLevel" "ReadingProfile";

-- improvedToLevel is present exactly when reason = IMPROVED_READING_LEVEL.
-- COALESCE keeps both sides non-null booleans (a NULL would pass the CHECK).
-- Prisma cannot express this; PRESERVE IT when editing AralMosyDecision migrations.
ALTER TABLE "AralMosyDecision" ADD CONSTRAINT "AralMosyDecision_improved_level_iff_reason"
  CHECK ((COALESCE("reason"::text, '') = 'IMPROVED_READING_LEVEL') = ("improvedToLevel" IS NOT NULL));

-- Rollback: drop the constraint, then the column (data loss for the column).
-- Destructive, needs project-owner approval (CLAUDE.md).
