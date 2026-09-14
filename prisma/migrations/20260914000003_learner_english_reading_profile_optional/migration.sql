-- Grade 1 and Grade 2 stop collecting an English reading level (Kinder and
-- Grade 3+ are unaffected). Widened, not dropped or renamed: every row written
-- before this migration already carries a value and is untouched; only a
-- Grade 1/Grade 2 learner created or edited by the accompanying application
-- change may now save one with englishReadingProfile left NULL.
ALTER TABLE "Learner" ALTER COLUMN "englishReadingProfile" DROP NOT NULL;

-- No index touches this column; no backfill; no data rewritten.
-- Rollback: `ALTER TABLE "Learner" ALTER COLUMN "englishReadingProfile" SET NOT
-- NULL` only succeeds while every row is still non-NULL. Once a Grade 1/Grade 2
-- learner is saved with no English value there is no honest value to backfill
-- with (decision I) - treat this as a one-way door once the application change
-- ships.
