-- Kinder/Grade 1/Grade 2 reading rubric (docs/reading-policy-spec.md). Four new
-- members on the existing "ReadingProfile" enum. Grades 3-10 keep writing the
-- original four values; Grade 11-12 keep writing three of the original four
-- (Zod-only restriction, no schema change - see migration ...003's note).
-- Purely additive: no existing row can hold one of these values yet, and
-- nothing else in this file uses them, so there is no same-transaction hazard.
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CANNOT_NAME_SOUND_LETTERS';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'LETTER_LEVEL';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CV_BLENDING';
ALTER TYPE "ReadingProfile" ADD VALUE IF NOT EXISTS 'CVC_BLENDING';

-- Rollback: Postgres cannot drop a single enum value; only rebuilding the type
-- (rename, recreate, cast every column, drop the renamed type) can remove one,
-- and that is destructive the moment any row holds one of these four. Safe to
-- roll back only before the accompanying application change ships.
