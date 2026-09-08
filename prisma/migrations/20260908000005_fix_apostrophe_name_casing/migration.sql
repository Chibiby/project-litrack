-- ===========================================================================
-- Fix: litrack_format_person_name() disagreed with the app on apostrophes
-- ===========================================================================
-- 20260908000003 leaned on initcap() to capitalise across internal punctuation.
-- That is correct for hyphens ("mary-jane" -> "Mary-Jane") but NOT for
-- apostrophes on this server: initcap('o''brien') returns 'O''brien', not
-- 'O''Brien'. So the backfill stored "O'brien" while formatPersonName() in
-- src/lib/names.ts stores "O'Brien" — the same split-brain the whole change set
-- exists to remove, just moved from the import path to the migration.
--
-- initcap also splits on every non-alphanumeric, where the TypeScript splits
-- only on "-", "'" and "’". So "juan.cruz" became "Juan.Cruz" in SQL but stays
-- "Juan.cruz" in the app.
--
-- This redefines the function to walk the token character by character, which
-- mirrors capitalizeParts() exactly, and re-runs the name backfill. Rows that
-- were already correct are untouched by the WHERE clauses.
-- ===========================================================================

CREATE OR REPLACE FUNCTION litrack_format_person_name(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  collapsed  text;
  tokens     text[];
  out_tokens text[] := ARRAY[]::text[];
  tok        text;
  bare       text;
  built      text;
  ch         text;
  prev       text;
  i          int;
  j          int;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  collapsed := btrim(regexp_replace(raw, '\s+', ' ', 'g'));
  IF collapsed = '' THEN
    RETURN collapsed;
  END IF;

  tokens := string_to_array(collapsed, ' ');

  FOR i IN 1 .. array_length(tokens, 1) LOOP
    tok  := tokens[i];
    bare := regexp_replace(tok, '\.$', '');

    -- A generational suffix ("III", "IV."). Only ever from the second token on:
    -- a lone "Vi" or "Di" is a given name, and upper-casing it would be worse
    -- than leaving it alone.
    IF i > 1
       AND length(bare) >= 2
       AND upper(bare) ~ '^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$'
    THEN
      out_tokens := out_tokens || upper(tok);
      CONTINUE;
    END IF;

    -- Capitalise the first character and any character following one of the
    -- three separators the application splits on, and nothing else. Matches
    -- capitalizeParts() in src/lib/names.ts, including its deliberate refusal
    -- to capitalise after a full stop.
    tok   := lower(tok);
    built := '';
    prev  := NULL;

    FOR j IN 1 .. length(tok) LOOP
      ch := substr(tok, j, 1);
      IF prev IS NULL OR prev IN ('-', '''', '’') THEN
        built := built || upper(ch);
      ELSE
        built := built || ch;
      END IF;
      prev := ch;
    END LOOP;

    -- "mcdonald" -> "McDonald". Narrow on purpose: never "Mac", which would
    -- mangle ordinary given names like "Macario".
    IF built ~ '^Mc[a-z]' THEN
      built := 'Mc' || upper(substr(built, 3, 1)) || substr(built, 4);
    END IF;

    out_tokens := out_tokens || built;
  END LOOP;

  RETURN array_to_string(out_tokens, ' ');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Re-run the name backfill under the corrected rule.
-- ---------------------------------------------------------------------------
UPDATE "Learner"
SET "firstName"  = litrack_format_person_name("firstName"),
    "middleName" = NULLIF(litrack_format_person_name("middleName"), ''),
    "lastName"   = litrack_format_person_name("lastName")
WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "middleName" IS DISTINCT FROM NULLIF(litrack_format_person_name("middleName"), '')
   OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName");

UPDATE "Learner"
SET "fullName" = btrim(concat_ws(' ', "firstName", "middleName", "lastName"))
WHERE "fullName" IS DISTINCT FROM btrim(concat_ws(' ', "firstName", "middleName", "lastName"));

UPDATE "User"
SET "firstName"  = litrack_format_person_name("firstName"),
    "middleName" = NULLIF(litrack_format_person_name("middleName"), ''),
    "lastName"   = litrack_format_person_name("lastName")
WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "middleName" IS DISTINCT FROM NULLIF(litrack_format_person_name("middleName"), '')
   OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName");

UPDATE "User"
SET "fullName" = btrim(concat_ws(' ', "firstName", "middleName", "lastName"))
WHERE btrim(concat_ws(' ', "firstName", "middleName", "lastName")) <> ''
  AND "fullName" IS DISTINCT FROM btrim(concat_ws(' ', "firstName", "middleName", "lastName"));

UPDATE "TeacherInvite"
SET "firstName"  = litrack_format_person_name("firstName"),
    "middleName" = NULLIF(litrack_format_person_name("middleName"), ''),
    "lastName"   = litrack_format_person_name("lastName")
WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "middleName" IS DISTINCT FROM NULLIF(litrack_format_person_name("middleName"), '')
   OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName");
