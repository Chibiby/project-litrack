-- Replace the Grade 1-10 End of Terms default subject templates
-- ("TermSubjectDefault") with the project owner's per-grade lists.
--
-- DATA ONLY. No DDL. Touches "TermSubjectDefault" rows for G1..G10 and
-- nothing else: KINDER (already edited by hand in the Super Admin screen),
-- G11 and G12 are left exactly as they are. No school's own "TermSubject"
-- rows and no "TermGrade" score is read or written -- existing schools keep
-- their lists until a School Head presses "Reset to default".
--
-- TARGET TEMPLATES (display order = position)
-- =========================================================================
--   G1      Reading and Literacy, Language, Makabansa, GMRC, Math
--   G2      English, Filipino, Math, GMRC, Makabansa
--   G3      English, Filipino, Math, GMRC, Makabansa, Science
--   G4-G10  Math, Science, English, Filipino, MAPEH, Araling Panlipunan,
--           TLE, GMRC
--
-- WHAT THIS DOES, IN ORDER (per G1..G10 type)
-- =========================================================================
--   1. Archive (set "deletedAt") every ACTIVE row whose name is not in the
--      target list. Remove is archive, never DELETE, matching the Super
--      Admin screen, so an archived row can still be restored there.
--   2. Re-position (and normalise the spelling of) every ACTIVE row whose
--      name IS in the target list.
--   3. Restore the most recently archived row for each target name that
--      still has no active row (so re-running never duplicates).
--   4. Insert every target name that has no active row after step 3.
--
-- Names compare on lower(btrim(name)), the same expression as the SQL-only
-- partial unique "TermSubjectDefault_type_active_name_unique", which this
-- migration does not touch. Every step is idempotent: re-running it on a
-- database already in the target state changes nothing but "updatedAt" on
-- step 2's rows.
--
-- LOCKING / SIZE
-- =========================================================================
-- Row locks only, on at most ~80 rows of a Super-Admin-only table. Run in
-- one batch; the temp table is dropped at the end.
--
-- ROLLBACK
-- =========================================================================
-- No data is destroyed: archived rows keep their names and can be restored
-- from /admin/term-subjects, or by clearing "deletedAt" for the rows this
-- migration archived (their "updatedAt" equals the apply time).

CREATE TEMP TABLE "_term_subject_default_target" (
    "gradeLevelType" "GradeLevelType" NOT NULL,
    "name"           TEXT NOT NULL,
    "position"       INTEGER NOT NULL
);

INSERT INTO "_term_subject_default_target" ("gradeLevelType", "name", "position")
SELECT t.type::"GradeLevelType", d.name, d.pos
FROM (VALUES ('G1')) AS t(type)
CROSS JOIN (VALUES
    ('Reading and Literacy', 0),
    ('Language', 1),
    ('Makabansa', 2),
    ('GMRC', 3),
    ('Math', 4)
) AS d(name, pos)
UNION ALL
SELECT t.type::"GradeLevelType", d.name, d.pos
FROM (VALUES ('G2')) AS t(type)
CROSS JOIN (VALUES
    ('English', 0),
    ('Filipino', 1),
    ('Math', 2),
    ('GMRC', 3),
    ('Makabansa', 4)
) AS d(name, pos)
UNION ALL
SELECT t.type::"GradeLevelType", d.name, d.pos
FROM (VALUES ('G3')) AS t(type)
CROSS JOIN (VALUES
    ('English', 0),
    ('Filipino', 1),
    ('Math', 2),
    ('GMRC', 3),
    ('Makabansa', 4),
    ('Science', 5)
) AS d(name, pos)
UNION ALL
SELECT t.type::"GradeLevelType", d.name, d.pos
FROM (VALUES ('G4'), ('G5'), ('G6'), ('G7'), ('G8'), ('G9'), ('G10')) AS t(type)
CROSS JOIN (VALUES
    ('Math', 0),
    ('Science', 1),
    ('English', 2),
    ('Filipino', 3),
    ('MAPEH', 4),
    ('Araling Panlipunan', 5),
    ('TLE', 6),
    ('GMRC', 7)
) AS d(name, pos);

-- 1. Archive active rows not in the target list.
UPDATE "TermSubjectDefault" d
SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE d."deletedAt" IS NULL
  AND d."gradeLevelType" IN ('G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10')
  AND NOT EXISTS (
      SELECT 1 FROM "_term_subject_default_target" t
      WHERE t."gradeLevelType" = d."gradeLevelType"
        AND lower(btrim(t."name")) = lower(btrim(d."name"))
  );

-- 2. Re-position active rows in the target list, normalising name spelling.
UPDATE "TermSubjectDefault" d
SET "name" = t."name", "position" = t."position", "updatedAt" = CURRENT_TIMESTAMP
FROM "_term_subject_default_target" t
WHERE d."deletedAt" IS NULL
  AND t."gradeLevelType" = d."gradeLevelType"
  AND lower(btrim(t."name")) = lower(btrim(d."name"));

-- 3. Restore the newest archived row for each target name with no active row.
UPDATE "TermSubjectDefault" d
SET "deletedAt" = NULL, "name" = r."name", "position" = r."position", "updatedAt" = CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (a."gradeLevelType", lower(btrim(a."name")))
           a."id", t."name", t."position"
    FROM "TermSubjectDefault" a
    JOIN "_term_subject_default_target" t
      ON t."gradeLevelType" = a."gradeLevelType"
     AND lower(btrim(t."name")) = lower(btrim(a."name"))
    WHERE a."deletedAt" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM "TermSubjectDefault" active
          WHERE active."gradeLevelType" = a."gradeLevelType"
            AND lower(btrim(active."name")) = lower(btrim(a."name"))
            AND active."deletedAt" IS NULL
      )
    ORDER BY a."gradeLevelType", lower(btrim(a."name")), a."deletedAt" DESC, a."id"
) r
WHERE d."id" = r."id";

-- 4. Insert target names that still have no active row.
INSERT INTO "TermSubjectDefault" ("id", "gradeLevelType", "name", "position", "updatedAt")
SELECT gen_random_uuid()::text, t."gradeLevelType", t."name", t."position", CURRENT_TIMESTAMP
FROM "_term_subject_default_target" t
WHERE NOT EXISTS (
    SELECT 1 FROM "TermSubjectDefault" existing
    WHERE existing."gradeLevelType" = t."gradeLevelType"
      AND lower(btrim(existing."name")) = lower(btrim(t."name"))
      AND existing."deletedAt" IS NULL
);

DROP TABLE "_term_subject_default_target";
