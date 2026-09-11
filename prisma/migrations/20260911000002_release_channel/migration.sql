-- Release channel (§1–2 of the ten concerns): a per-user stamp for which release
-- they have acknowledged, and a notification type for the bell row.
--
-- Numbered 20260911000002, after everything already applied to production. The
-- approved plan named this 20260910000004, a number that was taken before the
-- plan was written; a migration sorting behind ones production already holds
-- would be applied out of order.
--
-- BOTH ADDITIVE, AND NEITHER BACKFILLED
-- ------------------------------------
-- Every existing user has acknowledged nothing, and NULL is the honest record of
-- that. Backfilling to the current version would silently mark the whole user
-- base as having read release notes nobody has been shown.
--
-- APPLY THIS BEFORE THE CODE THAT READS IT — THIS ONE IS NOT OPTIONAL
-- ------------------------------------------------------------------
-- `getCurrentUser` loads the user with a bare `findUnique` and no `select`, so
-- the generated client asks for every column the schema names. Once the schema
-- carries `lastSeenReleaseVersion`, every signed-in request selects it. Shipping
-- the code first would fail every authenticated page with P2022, not only the
-- release surfaces. Applied first, it is invisible: the running code ignores a
-- column it does not know about.
--
-- ENUM VALUE
-- ----------
-- Postgres allows adding an enum value inside a transaction, but the value
-- cannot be USED in that same transaction. Nothing here writes it — the first
-- write is `announceRelease`, from the application — so this is safe, and the
-- same shape `20260910000003_chat_channels` used for CHAT_MENTION.
--
-- Idempotent: both statements are guarded by IF NOT EXISTS.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RELEASE_PUBLISHED';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenReleaseVersion" TEXT;
