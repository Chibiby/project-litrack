-- Make the KINDER End of Terms default subject template ("TermSubjectDefault")
-- the same as Grade 1's: Reading and Literacy, Language, Makabansa, GMRC,
-- Math, in that order.
--
-- DATA ONLY. No DDL. Touches KINDER "TermSubjectDefault" rows and nothing
-- else: no other grade type, no school's own "TermSubject" rows, no
-- "TermGrade" score. Same four idempotent steps as
-- 20260915000004_term_subject_defaults_deped_matatag (archive, re-position,
-- restore, insert; names compared on lower(btrim(name))), so re-running it
-- changes nothing. Archive, never DELETE: rollback is restoring rows from
-- /admin/term-subjects.

CREATE TEMP TABLE "_term_subject_default_target" (
    "gradeLevelType" "GradeLevelType" NOT NULL,
    "name"           TEXT NOT NULL,
    "position"       INTEGER NOT NULL
);

INSERT INTO "_term_subject_default_target" ("gradeLevelType", "name", "position")
VALUES
    ('KINDER', 'Reading and Literacy', 0),
    ('KINDER', 'Language', 1),
    ('KINDER', 'Makabansa', 2),
    ('KINDER', 'GMRC', 3),
    ('KINDER', 'Math', 4);

-- 1. Archive active rows not in the target list.
UPDATE "TermSubjectDefault" d
SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE d."deletedAt" IS NULL
  AND d."gradeLevelType" = 'KINDER'
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
