-- ===========================================================================
-- Backfill: canonical person-name casing, canonical PH phones, canonical spacing
-- ===========================================================================
-- Names were only ever normalized on the CSV import path, so a learner typed by
-- hand was stored exactly as keyed ("juan dela cruz") while the same learner
-- imported became "Juan Dela Cruz". Staff names were never normalized at all.
-- The application now formats every write through src/lib/names.ts; this brings
-- the rows that predate that change into the same shape.
--
-- Data-only. Adds no constraint, so it cannot fail on existing duplicates —
-- the case-insensitive unique indexes are a separate, later migration that must
-- not be applied until prisma/reports/data-uniformity-preflight.sql is clean.
--
-- Deliberately NOT touched: User.email. It is dual-written with Supabase Auth,
-- so lower-casing it here without the matching Auth update would break sign-in.
-- Section 4 of the pre-flight report lists any case-variant emails for manual
-- handling through docs/runbook.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Mirrors formatPersonName() in src/lib/names.ts. Kept in the database as a
-- permanent function so the pre-flight report can be re-run to verify 0 rows
-- remain, and so a future backfill does not have to redefine the rules.
--
-- initcap() already matches the TS rule for spaces, hyphens and apostrophes
-- ("mary-jane" -> "Mary-Jane", "o'brien" -> "O'Brien", "dela cruz" ->
-- "Dela Cruz"). Only the roman-numeral suffix and the narrow "Mc" case need
-- handling on top of it.
-- ---------------------------------------------------------------------------
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
  i          int;
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
    ELSE
      tok := initcap(lower(tok));
      -- "mcdonald" -> "McDonald". Narrow on purpose: never "Mac", which would
      -- mangle ordinary given names like "Macario".
      IF tok ~ '^Mc[a-z]' THEN
        tok := 'Mc' || upper(substr(tok, 3, 1)) || substr(tok, 4);
      END IF;
      out_tokens := out_tokens || tok;
    END IF;
  END LOOP;

  RETURN array_to_string(out_tokens, ' ');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Mirrors canonicalPhPhone() in src/lib/validators/phone.ts: separators dropped,
-- and the three interchangeable mobile spellings folded to local 09XXXXXXXXX.
-- Anything that is not a recognisable PH number is returned untouched — those
-- rows predate validation and are not this migration's to guess at.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION litrack_canonical_ph_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  n      text;
  mobile text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  n := regexp_replace(btrim(raw), '[[:space:]\-().]', '', 'g');

  mobile := substring(n from '^\+?63(9[0-9]{9})$');
  IF mobile IS NOT NULL THEN
    RETURN '0' || mobile;
  END IF;

  IF n ~ '^09[0-9]{9}$' OR n ~ '^0[2-7][0-9]{7,9}$' OR n ~ '^08[2-8][0-9]{6,8}$' THEN
    RETURN n;
  END IF;

  RETURN raw;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Learner names. Soft-deleted rows are included on purpose: an archived learner
-- that is later restored must come back in the same shape as everyone else.
-- ---------------------------------------------------------------------------
UPDATE "Learner"
SET "firstName"  = litrack_format_person_name("firstName"),
    "middleName" = NULLIF(litrack_format_person_name("middleName"), ''),
    "lastName"   = litrack_format_person_name("lastName")
WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "middleName" IS DISTINCT FROM NULLIF(litrack_format_person_name("middleName"), '')
   OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName");

-- fullName is denormalized and read by the roster, search and every export, so
-- it is rebuilt from the parts rather than formatted independently.
UPDATE "Learner"
SET "fullName" = btrim(concat_ws(' ', "firstName", "middleName", "lastName"))
WHERE "fullName" IS DISTINCT FROM btrim(concat_ws(' ', "firstName", "middleName", "lastName"));

-- ---------------------------------------------------------------------------
-- Staff names (Super Admin, School Heads, Teachers) and pending invites.
-- ---------------------------------------------------------------------------
UPDATE "User"
SET "firstName"  = litrack_format_person_name("firstName"),
    "middleName" = NULLIF(litrack_format_person_name("middleName"), ''),
    "lastName"   = litrack_format_person_name("lastName")
WHERE "firstName"  IS DISTINCT FROM litrack_format_person_name("firstName")
   OR "middleName" IS DISTINCT FROM NULLIF(litrack_format_person_name("middleName"), '')
   OR "lastName"   IS DISTINCT FROM litrack_format_person_name("lastName");

-- School Head rows created alongside a school start with empty name parts and a
-- fullName holding the school name (see createSchool). Rebuilding from the parts
-- would blank those, so they keep whatever fullName they already have.
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

-- ---------------------------------------------------------------------------
-- Contact numbers.
-- ---------------------------------------------------------------------------
UPDATE "TeacherProfile"
SET "contactNumber" = litrack_canonical_ph_phone("contactNumber")
WHERE "contactNumber" IS DISTINCT FROM litrack_canonical_ph_phone("contactNumber");

UPDATE "SchoolHeadProfile"
SET "contactNumber" = litrack_canonical_ph_phone("contactNumber")
WHERE "contactNumber" IS DISTINCT FROM litrack_canonical_ph_phone("contactNumber");

-- ---------------------------------------------------------------------------
-- Place and organisation labels: spacing only. Letter case is left exactly as
-- entered, because "Region XI" and "Sample Central ES" both break under
-- title-casing and there is no safe rule that covers school names.
-- ---------------------------------------------------------------------------
UPDATE "School"
SET name     = btrim(regexp_replace(name, '\s+', ' ', 'g')),
    address  = NULLIF(btrim(regexp_replace(COALESCE(address,  ''), '\s+', ' ', 'g')), ''),
    region   = NULLIF(btrim(regexp_replace(COALESCE(region,   ''), '\s+', ' ', 'g')), ''),
    division = NULLIF(btrim(regexp_replace(COALESCE(division, ''), '\s+', ' ', 'g')), ''),
    district = NULLIF(btrim(regexp_replace(COALESCE(district, ''), '\s+', ' ', 'g')), '')
WHERE name     IS DISTINCT FROM btrim(regexp_replace(name, '\s+', ' ', 'g'))
   OR address  IS DISTINCT FROM NULLIF(btrim(regexp_replace(COALESCE(address,  ''), '\s+', ' ', 'g')), '')
   OR region   IS DISTINCT FROM NULLIF(btrim(regexp_replace(COALESCE(region,   ''), '\s+', ' ', 'g')), '')
   OR division IS DISTINCT FROM NULLIF(btrim(regexp_replace(COALESCE(division, ''), '\s+', ' ', 'g')), '')
   OR district IS DISTINCT FROM NULLIF(btrim(regexp_replace(COALESCE(district, ''), '\s+', ' ', 'g')), '');

UPDATE "Section"
SET name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
WHERE name IS DISTINCT FROM btrim(regexp_replace(name, '\s+', ' ', 'g'));
