-- ===========================================================================
-- LITRACK data-uniformity pre-flight  (READ ONLY — makes no changes)
-- ===========================================================================
-- Run this BEFORE applying 20260908000003_normalize_existing_data and BEFORE
-- 20260908000004_case_insensitive_name_uniqueness.
--
-- Sections 1–3 tell you whether the uniqueness migration can apply at all: a
-- case-insensitive unique index cannot be created while case-variant duplicates
-- exist. Merge or rename anything those sections return, then re-run this file.
--
-- Sections 4–7 are informational: they show what the backfill will change.
--
--   psql "$DIRECT_URL" -f prisma/reports/data-uniformity-preflight.sql
--
-- Safe to run against production. It only SELECTs.
-- ===========================================================================

\echo '=== 1. Schools whose names differ only by case/spacing (BLOCKS the unique index) ==='
SELECT lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS folded_name,
       count(*)                                            AS rows,
       array_agg(name ORDER BY name)                       AS variants,
       array_agg(id   ORDER BY name)                       AS school_ids
FROM "School"
GROUP BY 1
HAVING count(*) > 1
ORDER BY 1;

\echo ''
\echo '=== 2. Real schools sharing a School ID case-insensitively (BLOCKS the unique index) ==='
-- Demo schools are exempt by design; they are excluded here for the same reason.
SELECT lower("schoolIdCode")                     AS folded_code,
       count(*)                                  AS rows,
       array_agg("schoolIdCode" ORDER BY name)   AS variants,
       array_agg(name           ORDER BY name)   AS schools
FROM "School"
WHERE "isDemo" = false
GROUP BY 1
HAVING count(*) > 1
ORDER BY 1;

\echo ''
\echo '=== 3. Sections colliding within one grade (BLOCKS the unique index) ==='
SELECT s."gradeLevelId",
       sc.name                                     AS school,
       lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')) AS folded_name,
       count(*)                                    AS rows,
       array_agg(s.name ORDER BY s.name)           AS variants,
       array_agg(s.id   ORDER BY s.name)           AS section_ids
FROM "Section" s
JOIN "School" sc ON sc.id = s."schoolId"
WHERE s."deletedAt" IS NULL
GROUP BY s."gradeLevelId", sc.name, 3
HAVING count(*) > 1
ORDER BY sc.name, 1;

\echo ''
\echo '=== 4. Account emails differing only by case (NOT auto-fixed — see note) ==='
-- The backfill deliberately leaves emails alone: User.email is dual-written with
-- Supabase Auth, so rewriting one side without the other breaks sign-in. If this
-- returns rows, resolve them by hand through the ops runbook.
SELECT lower(email) AS folded_email,
       count(*)     AS rows,
       array_agg(email ORDER BY email) AS variants,
       array_agg(id    ORDER BY email) AS user_ids
FROM "User"
WHERE email IS NOT NULL
GROUP BY 1
HAVING count(*) > 1
ORDER BY 1;

\echo ''
\echo '=== 5. How many learner / user / invite names the backfill will rewrite ==='
SELECT 'Learner' AS table_name,
       count(*) FILTER (WHERE "firstName" IS DISTINCT FROM litrack_format_person_name("firstName")
                           OR "lastName"  IS DISTINCT FROM litrack_format_person_name("lastName")
                           OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName")) AS rows_changing,
       count(*) AS rows_total
FROM "Learner"
UNION ALL
SELECT 'User',
       count(*) FILTER (WHERE "firstName" IS DISTINCT FROM litrack_format_person_name("firstName")
                           OR "lastName"  IS DISTINCT FROM litrack_format_person_name("lastName")
                           OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName")),
       count(*)
FROM "User"
UNION ALL
SELECT 'TeacherInvite',
       count(*) FILTER (WHERE "firstName" IS DISTINCT FROM litrack_format_person_name("firstName")
                           OR "lastName"  IS DISTINCT FROM litrack_format_person_name("lastName")
                           OR "middleName" IS DISTINCT FROM litrack_format_person_name("middleName")),
       count(*)
FROM "TeacherInvite";
-- NOTE: section 5 needs litrack_format_person_name(), which the backfill migration
-- creates. Run it after that migration to confirm 0 rows remain, or create the
-- function first from the migration's own CREATE FUNCTION block to preview.

\echo ''
\echo '=== 6. A sample of the learner names that will change ==='
SELECT id,
       "firstName" AS old_first, litrack_format_person_name("firstName") AS new_first,
       "lastName"  AS old_last,  litrack_format_person_name("lastName")  AS new_last
FROM "Learner"
WHERE "firstName" IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "lastName"  IS DISTINCT FROM litrack_format_person_name("lastName")
ORDER BY "lastName"
LIMIT 50;

\echo ''
\echo '=== 7. Values now too long for their column limit (rejected on next edit) ==='
-- These are not changed by the backfill. They were silently truncated before and
-- are now validation errors, so a School Head editing one of these rows will be
-- asked to shorten it. Listed so the change is not a surprise.
SELECT id, name,
       length(address)  AS address_len,
       length(region)   AS region_len,
       length(division) AS division_len,
       length(district) AS district_len
FROM "School"
WHERE length(address)  > 500
   OR length(region)   > 100
   OR length(division) > 100
   OR length(district) > 100;
