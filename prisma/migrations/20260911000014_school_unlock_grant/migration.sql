-- One unlock covering every teacher in a school for one window.
--
-- WHY A TABLE AND NOT A NULLABLE `UnlockGrant.userId`: in Postgres, two NULLs
-- never compare equal, so `@@unique([userId, scope, targetKey])` treats every
-- NULL-userId row as distinct from every other one. A school-wide grant
-- modeled as `UnlockGrant` with `userId = NULL` would silently defeat that
-- unique — nothing would stop a second, third, or Nth live school-wide grant
-- for the same scope and window from being issued alongside the first — and
-- "is this window open for the school?" would then depend on which row a
-- query happens to see first, not on a single row of truth. A dedicated table
-- with its own `(schoolId, scope, targetKey)` unique avoids the NULL-collapse
-- problem entirely: the columns that make a window unique are all NOT NULL.
CREATE TABLE "SchoolUnlockGrant" (
    "id"          TEXT NOT NULL,
    "schoolId"    TEXT NOT NULL,
    "scope"       "UnlockScope" NOT NULL,
    "targetKey"   TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "revokedAt"   TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolUnlockGrant_pkey" PRIMARY KEY ("id")
);

-- One grant row per window per school — same reasoning as UnlockGrant's own
-- unique: a re-grant updates this row rather than stacking a second one, so
-- "is it open?" never depends on row order.
CREATE UNIQUE INDEX "SchoolUnlockGrant_schoolId_scope_targetKey_key"
    ON "SchoolUnlockGrant"("schoolId", "scope", "targetKey");

-- The hot read: this school, this scope, still in date, on every save into a
-- closed window that a school-wide grant might have reopened.
CREATE INDEX "SchoolUnlockGrant_schoolId_scope_expiresAt_idx"
    ON "SchoolUnlockGrant"("schoolId", "scope", "expiresAt");

-- R6. FK-enforcement lookup sides.
CREATE INDEX "SchoolUnlockGrant_grantedById_idx" ON "SchoolUnlockGrant"("grantedById");
CREATE INDEX "SchoolUnlockGrant_revokedById_idx" ON "SchoolUnlockGrant"("revokedById");

ALTER TABLE "SchoolUnlockGrant" ADD CONSTRAINT "SchoolUnlockGrant_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolUnlockGrant" ADD CONSTRAINT "SchoolUnlockGrant_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SchoolUnlockGrant" ADD CONSTRAINT "SchoolUnlockGrant_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchoolUnlockGrant" ENABLE ROW LEVEL SECURITY;
