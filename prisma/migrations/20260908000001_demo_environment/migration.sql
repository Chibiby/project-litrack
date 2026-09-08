-- Demo / training environment.
--
-- Additive only: one nullable-free boolean with a default (so existing rows are
-- backfilled to false by Postgres itself) plus a new standalone table. Nothing
-- here rewrites or drops existing data.

-- The demonstration tenant flag. Real schools stay false forever.
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Reads are always `isDemo = false` (hide the demo) or `isDemo = true` (find it),
-- and the true side is a single row, so this stays a cheap, highly selective index.
CREATE INDEX IF NOT EXISTS "School_isDemo_idx" ON "School"("isDemo");

-- Global operator switches. `key` is the primary key; there is no schoolId
-- because these are deliberately tenant-less.
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
