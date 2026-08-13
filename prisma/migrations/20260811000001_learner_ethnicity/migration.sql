-- Learner ethnicity (Section A), nullable for learners rostered before it was collected.
-- ethnicityOther holds free text only when ethnicity = 'OTHER'.

CREATE TYPE "Ethnicity" AS ENUM (
  'BISAYA',
  'ILONGGO',
  'BLAAN',
  'TAGAKAOLO',
  'TBOLI',
  'BADJAO',
  'MARANAO',
  'TAUSOG',
  'MAGUINDANAON',
  'ILOCANO',
  'TAGALOG',
  'FOREIGN',
  'OTHER'
);

ALTER TABLE "Learner" ADD COLUMN "ethnicity" "Ethnicity";
ALTER TABLE "Learner" ADD COLUMN "ethnicityOther" TEXT;
