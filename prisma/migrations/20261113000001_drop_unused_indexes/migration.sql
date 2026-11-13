-- Drop two indexes that no query uses (0 scans in production since the
-- compute started on 2026-11-09).
-- "User_authId_idx" duplicates the unique index on "User"."authId".
-- "TermSubject_gradeLevelId_deletedAt_position_idx": the table is small
-- enough that every read uses the unique (gradeLevelId, legacyArea) index
-- or a scan.
DROP INDEX IF EXISTS "User_authId_idx";
DROP INDEX IF EXISTS "TermSubject_gradeLevelId_deletedAt_position_idx";

-- Query statistics for tuning. Idempotent; Neon preloads the module.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
