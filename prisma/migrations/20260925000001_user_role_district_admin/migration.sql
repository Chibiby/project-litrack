-- Add UserRole.DISTRICT_ADMIN.
--
-- ALONE IN ITS OWN FILE, DELIBERATELY, for the same reason as
-- 20260911000012_monthly_reading_level_unlock_scope and
-- 20260911000013_unlock_granted_notification_type: PostgreSQL forbids using a
-- newly added enum value inside the transaction that added it, and each
-- migration file here runs as one transaction. Nothing in this file may
-- reference 'DISTRICT_ADMIN' — that starts in a later migration (the account
-- creation script, run only after this and 20260925000002 are both applied).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DISTRICT_ADMIN';
