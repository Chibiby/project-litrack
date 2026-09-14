-- Section A nutritional status gains "Overweight", ordered between Normal and
-- Obese to match the DepEd display order (docs/reading-policy-spec.md).
ALTER TYPE "NutritionalStatus" ADD VALUE IF NOT EXISTS 'OVERWEIGHT' BEFORE 'OBESE';

-- Rollback: same caveat as migration ...001 - safe only before any row is
-- saved with OVERWEIGHT.
