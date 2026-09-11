-- Point a Notification at the grant that produced it (personal or
-- school-wide), so UNLOCK_GRANTED notifications can compose their text from
-- the grant row instead of duplicating scope/targetKey/expiresAt onto
-- Notification itself.
ALTER TABLE "Notification" ADD COLUMN "unlockGrantId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "schoolUnlockGrantId" TEXT;

CREATE INDEX "Notification_unlockGrantId_idx" ON "Notification"("unlockGrantId");
CREATE INDEX "Notification_schoolUnlockGrantId_idx" ON "Notification"("schoolUnlockGrantId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_unlockGrantId_fkey"
    FOREIGN KEY ("unlockGrantId") REFERENCES "UnlockGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolUnlockGrantId_fkey"
    FOREIGN KEY ("schoolUnlockGrantId") REFERENCES "SchoolUnlockGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SQL-ONLY. Prisma's schema language cannot express a CHECK constraint, so
-- this exists only here — the same situation as Enrollment's one-ACTIVE-row
-- partial unique index. Preserve it when editing this table's migrations: a
-- notification may point at a personal grant or a school-wide grant, never
-- both, because a single notification describes one unlock event.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_one_unlock_pointer"
    CHECK (NOT ("unlockGrantId" IS NOT NULL AND "schoolUnlockGrantId" IS NOT NULL));
