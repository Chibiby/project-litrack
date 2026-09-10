-- Wave A of multi-advisory: move the advisory pointer onto `Section`.
--
-- WHY
-- ---
-- §4 of the ten concerns. A teacher may advise up to three sections. Today
-- `User.advisorySectionId` is `@unique`, and that ONE index enforces two
-- different rules at once: one section per teacher, and one teacher per
-- section. The second is wanted; the first is the limitation being removed.
--
-- Putting the pointer on `Section` separates them. A Section row holds one
-- `adviserId`, so "at most one adviser per section" is guaranteed by the shape
-- of the table and needs no index at all. Nothing then limits how many sections
-- name the same teacher, which is the point.
--
-- NO UNIQUE INDEX ON "adviserId", DELIBERATELY
-- -------------------------------------------
-- The approved design says to add `Section.adviserId` "with its unique index".
-- That is an error in the design, and following it would defeat the change: a
-- unique index here means no two Section rows may name the same teacher — the
-- one-section-per-teacher rule, reimposed on the other side of the relation,
-- and the cap of three would then be unreachable. The design's very next
-- sentence ("a section still has at most one adviser, guaranteed in SQL") is
-- true without any index, which is where the confusion came from. A plain index
-- is created instead, because "which sections does this teacher advise?" is now
-- the hot question behind every scope predicate.
--
-- The cap of three lives in `setTeacherAdvisory`, not in SQL, so the number can
-- change without another migration.
--
-- ADDITIVE, AND WAVE A ONLY
-- -------------------------
-- `User.advisorySectionId` is NOT touched here. It keeps its column, its FK and
-- its unique index, and stays dual-written by the two writers that own it. It is
-- read by nothing for access after this. Wave B drops it, separately approved,
-- once this is confirmed in production. That is the same state `taughtGrades`
-- has been in since the grade→section migration, made explicit.
--
-- BACKFILL
-- --------
-- Copied faithfully from the legacy pointer, including rows whose adviser is
-- soft-deleted. That is not an oversight: `Section.adviser` resolved to exactly
-- those users before this migration too — it was the back-reference of the same
-- pointer — so copying anything less would change behaviour under cover of a
-- data move. `deleteTeacherAccounts` clears `advisorySectionId` when it
-- tombstones a teacher, so the case is rare by construction.
--
-- Idempotent: re-running rewrites the same rows with the same values, and the
-- ADD COLUMN / ADD CONSTRAINT / CREATE INDEX steps are guarded by IF NOT EXISTS
-- so a partially applied run can be finished rather than unpicked.

ALTER TABLE "Section" ADD COLUMN IF NOT EXISTS "adviserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Section_adviserId_fkey'
  ) THEN
    ALTER TABLE "Section"
      ADD CONSTRAINT "Section_adviserId_fkey"
      FOREIGN KEY ("adviserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Plain, not unique. See the note above.
CREATE INDEX IF NOT EXISTS "Section_adviserId_idx" ON "Section"("adviserId");

UPDATE "Section" AS s
SET "adviserId" = u."id"
FROM "User" AS u
WHERE u."advisorySectionId" = s."id"
  AND s."adviserId" IS DISTINCT FROM u."id";

-- BREAKING THE CYCLE
-- ------------------
-- Run AFTER the backfill, which reads the column this drops the constraint on.
--
-- With a foreign key now pointing Section -> User, the old User -> Section key
-- makes the two tables mutually dependent, and no single write order satisfies
-- both. Snapshot restore walks one fixed order per table
-- (`src/lib/db/schema-order.ts`), so a cycle is not merely inelegant there: one
-- of the two inserts is guaranteed to violate its key.
--
-- The authoritative side wins. `User.advisorySectionId` keeps its column and its
-- unique index but loses its foreign key, becoming a plain nullable column —
-- exactly what `School.createdById` and `AuditLog.userId` already are, and for
-- the same reason. The cost is that deleting a Section no longer nulls this
-- mirror, so it may hold a stale id. Nothing reads it, and Wave B drops the
-- column outright.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_advisorySectionId_fkey";
