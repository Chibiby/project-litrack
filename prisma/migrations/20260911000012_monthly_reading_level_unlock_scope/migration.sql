-- Add UnlockScope.MONTHLY_READING_LEVEL.
--
-- ALONE IN ITS OWN FILE, DELIBERATELY. PostgreSQL forbids using a newly added
-- enum value inside the same transaction that added it (each migration file
-- here runs as one transaction), so no later statement in this same file may
-- reference 'MONTHLY_READING_LEVEL' — not even indirectly through a CHECK or
-- a DEFAULT. Anything that needs to use the value goes in a later migration.
ALTER TYPE "UnlockScope" ADD VALUE IF NOT EXISTS 'MONTHLY_READING_LEVEL';
