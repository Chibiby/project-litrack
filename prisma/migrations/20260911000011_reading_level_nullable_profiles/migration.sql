-- Widen ReadingLevelRecord.englishProfile / filipinoProfile to nullable.
--
-- Loosening only. No data change: every existing row already carries both
-- values, so dropping NOT NULL does not touch a single row, and nothing here
-- rewrites the table. Purpose: partial monthly assessments (a teacher who has
-- only scored one language so far) become storable as a single row instead of
-- being blocked until both languages are entered.
--
-- MUST BE APPLIED BEFORE THE DEPLOY that ships the partial-row save. That
-- write path will submit a row with one of these columns NULL; applied after,
-- the insert fails NOT NULL and the feature cannot ship. Applied before, old
-- code keeps writing both columns as always and is unaffected.
ALTER TABLE "ReadingLevelRecord" ALTER COLUMN "englishProfile"  DROP NOT NULL;
ALTER TABLE "ReadingLevelRecord" ALTER COLUMN "filipinoProfile" DROP NOT NULL;
