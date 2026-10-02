-- MOSY move-out reason "Transferred out".
-- Category: additive (one enum value). No backfill.
-- The AralMosyDecision_improved_level_iff_reason CHECK compares reason via
-- ::text against 'IMPROVED_READING_LEVEL' only, so it holds for the new value
-- (improvedToLevel stays NULL).

ALTER TYPE "AralMosyMoveOutReason" ADD VALUE IF NOT EXISTS 'TRANSFERRED_OUT';

-- Rollback: Postgres cannot drop an enum value. Rebuilding the type is
-- destructive and needs project-owner approval (CLAUDE.md).
