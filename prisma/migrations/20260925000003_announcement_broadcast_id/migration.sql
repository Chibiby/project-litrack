-- Groups the per-school copies of one district/division broadcast.
--
-- NULL = written by the school's own School Head, which is what every
-- existing "Announcement" row already means, so this needs no backfill: the
-- column starts NULL everywhere and every existing row keeps reading exactly
-- as it did before. Non-null rows are read-only to School Heads (enforced in
-- application code, not here).
--
-- Purely additive: one nullable column and one plain index, no unique, so
-- NULLs are harmless. Safe to apply to a live database.

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN "broadcastId" TEXT;

-- CreateIndex
CREATE INDEX "Announcement_broadcastId_idx" ON "Announcement"("broadcastId");
