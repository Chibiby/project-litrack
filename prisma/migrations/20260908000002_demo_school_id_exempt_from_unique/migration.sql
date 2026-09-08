-- Let the demo tenant reuse a School ID that a real school already holds.
--
-- `schoolIdCode` was globally unique, which blocked provisioning the training
-- school on 123456 once a real school was created with that code. Real schools
-- must still not collide with each other, so the constraint is narrowed rather
-- than dropped: it now applies only where `isDemo` is false.
--
-- Prisma's schema language cannot express a partial unique index, so this index
-- exists in SQL only and `schoolIdCode` carries no `@unique` in schema.prisma —
-- the same arrangement as `Enrollment`'s one-ACTIVE-row-per-learner index.
-- Preserve it when editing School migrations.
--
-- Safe to apply with rows present: the new index is strictly weaker than the one
-- it replaces, so any data that satisfied the old constraint satisfies this one.
-- The demo school does not exist yet at the time this runs.

DROP INDEX IF EXISTS "School_schoolIdCode_key";

CREATE UNIQUE INDEX IF NOT EXISTS "School_schoolIdCode_real_key"
    ON "School"("schoolIdCode")
    WHERE "isDemo" = false;
