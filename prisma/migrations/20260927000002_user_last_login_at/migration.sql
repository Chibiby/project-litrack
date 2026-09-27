-- Adds "User"."lastLoginAt", set on successful sign-in going forward.
--
-- Additive only: one nullable column plus a one-time backfill that fills
-- nulls from existing history. No existing column is altered, dropped, or
-- rewritten.
--
-- Why: the project owner is deleting ~95% of AuditLog rows, including every
-- LOGIN_SUCCESS row. The account profile's "last signed in" display
-- (`getAccountProfile`, src/lib/actions/accounts.ts) currently reads the
-- latest LOGIN_SUCCESS AuditLog row per user -- that display must move to
-- this column before the prune runs, or it silently goes blank for every
-- user whose only LOGIN_SUCCESS rows are deleted.
--
-- Backfill: for each user with at least one LOGIN_SUCCESS audit row, take
-- MAX(timestamp) and write it into "lastLoginAt". Idempotent (only fills
-- rows still NULL) and safe to re-run. Users with no LOGIN_SUCCESS row (e.g.
-- never signed in, or all such rows already pruned) are left NULL, same as
-- the panel already treats "no login" today.
--
-- Deploy order: apply BEFORE shipping the code that writes "lastLoginAt" on
-- sign-in and reads it in place of the AuditLog query, and BEFORE the
-- AuditLog retention prune runs. Additive and inert on its own -- old code
-- never selects a column it does not know about.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- One-time backfill from AuditLog history. Only fills NULLs.
UPDATE "User" u
SET "lastLoginAt" = a."last"
FROM (
  SELECT "userId", MAX("timestamp") AS "last"
  FROM "AuditLog"
  WHERE "action" = 'LOGIN_SUCCESS'
    AND "userId" IS NOT NULL
  GROUP BY "userId"
) a
WHERE a."userId" = u."id"
  AND u."lastLoginAt" IS NULL;
