-- MOSY move-out reasons: add the per-level "Improved to <level>" reason.
-- Category: additive (one new enum value). No row is touched.
-- Why a separate migration: ALTER TYPE ... ADD VALUE must be committed before the
-- value can be used, so the next migration (column + CHECK) runs in its own
-- transaction. The legacy values IMPROVED_EARLY_GRADES / IMPROVED_UPPER_GRADES stay.

ALTER TYPE "AralMosyMoveOutReason" ADD VALUE 'IMPROVED_READING_LEVEL';

-- Rollback: Postgres cannot drop an enum value; it needs a type rebuild.
-- Destructive, needs project-owner approval (CLAUDE.md).
