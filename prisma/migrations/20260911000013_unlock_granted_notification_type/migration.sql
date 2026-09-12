-- Add NotificationType.UNLOCK_GRANTED.
--
-- ALONE IN ITS OWN FILE, DELIBERATELY, for the same reason as the
-- UnlockScope addition in 20260911000012: PostgreSQL forbids using a newly
-- added enum value inside the transaction that added it, and each migration
-- file here runs as one transaction. Nothing in this file may reference
-- 'UNLOCK_GRANTED' — that starts in a later migration.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'UNLOCK_GRANTED';
