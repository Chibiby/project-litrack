-- User profile photos (docs/superpowers/specs/2026-09-18-user-profile-photos-design.md).
--
-- One nullable column and one SQL-only CHECK. Purely additive: no existing
-- column is altered, dropped or rewritten, and no backfill runs. Every
-- existing "User" row already satisfies the CHECK (NULL passes it), so
-- this applies cleanly with zero rows touched.
--
--   User.avatarPath   Object key in the public Supabase Storage bucket
--                      "avatars" -- NOT a URL. Key shape:
--                      "<userId>/<uuid>.<webp|jpg|png>". The 128px
--                      thumbnail sibling "<userId>/<uuid>_128.<ext>" is
--                      derived from the same uuid and is never stored as
--                      its own column or row. NULL means no photo.
--
-- The CHECK mirrors "isValidAvatarPath" (src/lib/avatars/paths.ts) at the
-- database layer: Prisma's schema language cannot express a CHECK
-- constraint, so, like "TermGrade_score_range" and "TermGrade_score_xor_mark"
-- before it, this lives only here. Preserve it when editing User migrations.
--
-- "starts_with(..., id || '/')" pins the key to the owning row's own id --
-- one user can never point at another's storage prefix. The regexp then
-- pins the remainder to a lowercase-hex UUID plus one of the three allowed
-- extensions. Both conditions look only at the "avatarPath" and "id" of the
-- same row, so this is a same-row CHECK, not a foreign check.
--
-- This migration also adds the NotificationType value PROFILE_PHOTO_REMOVED,
-- sent to a photo's owner when someone else (a School Head or Super Admin)
-- removes it. Combined into this file rather than split, following the
-- precedent of 20260910000003_chat_channels (CHAT_MENTION,
-- CHAT_DIRECT_MESSAGE alongside CreateTable/AlterTable/CreateIndex/
-- AddForeignKey in one file) and 20260911000002_release_channel
-- (RELEASE_PUBLISHED alongside an AlterTable): Postgres allows adding an
-- enum value inside a transaction, it just cannot be USED in that same
-- transaction, and nothing in this file writes it -- the first write is the
-- application's moderation action. `migrate deploy` wraps one file in one
-- transaction either way, so one file vs. two makes no difference to safety
-- here, only to bookkeeping overhead.
--
-- Deploy order: apply this BEFORE the code that writes/reads "avatarPath"
-- ships. It is additive and inert on its own -- old code never selects a
-- column it does not know about. The direction that is NOT safe is
-- shipping the code first: `getCurrentUser` loads "User" without a narrow
-- `select`, so a regenerated Prisma client asks for every column the schema
-- names, and every signed-in request would fail with P2022 until this
-- migration lands. See docs/superpowers/specs/2026-09-18-user-profile-photos-design.md
-- "Apply order".

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarPath" TEXT;

-- SQL-only CHECK, same family as "TermGrade_score_range" and
-- "TermGrade_score_xor_mark" (docs/migrations.md). Preserve when editing
-- User migrations.
ALTER TABLE "User" ADD CONSTRAINT "User_avatarPath_shape"
  CHECK (
    "avatarPath" IS NULL
    OR (
      starts_with("avatarPath", "id" || '/')
      AND "avatarPath" ~ '^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
    )
  );

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROFILE_PHOTO_REMOVED';
