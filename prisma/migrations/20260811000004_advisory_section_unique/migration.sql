-- Tighten step: one adviser per section.
-- Runs after 20260811000003 has collapsed the TeacherSection m2m to at most one
-- teacher per section, so this index can be created without conflict.
--
-- Form chosen: a plain (non-partial) UNIQUE INDEX, named to Prisma's @unique
-- convention "User_advisorySectionId_key".
--   * Postgres treats NULLs as distinct in a unique index by default
--     (NULLS DISTINCT), so any number of teachers may have no advisory section.
--     A partial `WHERE "advisorySectionId" IS NOT NULL` index would behave the
--     same here but is invisible to Prisma's schema language, which would leave
--     permanent drift and risk a future generated diff dropping it -- the same
--     trap as "Enrollment_learner_active_unique". A plain unique index is what
--     `advisorySectionId String? @unique` maps to, so schema and database agree.
--
-- The plain index from 20260811000002 is redundant once the unique index exists
-- (it covers the same lookups and the FK), and keeping it would be drift against
-- the schema, which declares only @unique.

-- CreateIndex
CREATE UNIQUE INDEX "User_advisorySectionId_key" ON "User"("advisorySectionId");

-- DropIndex
-- Ordered after the CreateIndex so the column is never left unindexed.
DROP INDEX "User_advisorySectionId_idx";
