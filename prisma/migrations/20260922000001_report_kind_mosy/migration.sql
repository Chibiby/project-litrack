-- Add ReportKind.MOSY (Middle-of-School-Year report), ordered immediately
-- before CUSTOM to match the Prisma enum declaration order.
--
-- ALONE IN ITS OWN FILE, DELIBERATELY, for the same reason as the
-- NutritionalStatus/NotificationType additions in 20260911000013 and
-- 20260914000002: PostgreSQL forbids using a newly added enum value inside
-- the transaction that added it, and each migration file here runs as one
-- transaction. Nothing in this file may reference 'MOSY' — that starts in a
-- later migration.
ALTER TYPE "ReportKind" ADD VALUE IF NOT EXISTS 'MOSY' BEFORE 'CUSTOM';

-- Rollback: Postgres cannot drop an enum value in place. This is reversible
-- only before any row has been saved with kind = 'MOSY'.
