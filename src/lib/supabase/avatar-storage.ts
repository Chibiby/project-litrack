import "server-only";
import { AVATAR_BUCKET, AVATAR_CACHE_CONTROL_SECONDS } from "@/lib/avatars/limits";
import { buildAvatarPaths, type AvatarExt } from "@/lib/avatars/paths";
import type { AvatarMime } from "@/lib/avatars/sniff";
import { AppError } from "@/lib/errors/app-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The only writer of the `avatars` bucket.
 *
 * `server-only` and service-role: no client role can list, write or delete in
 * this bucket (`prisma/storage-avatars.sql` denies `anon` and `authenticated`
 * outright), so every byte that lands there passed through
 * `validateAvatarUpload` first. See
 * `docs/superpowers/specs/2026-09-18-user-profile-photos-design.md`.
 */

type PutAvatarObjectsInput = {
  userId: string;
  /** Freshly generated `crypto.randomUUID()`. Never reused — see `upsert: false` below. */
  objectId: string;
  ext: AvatarExt;
  /** The SNIFFED type, never the one the browser claimed. */
  mime: AvatarMime;
  full: Uint8Array;
  thumb: Uint8Array;
};

/**
 * Upload the full-size object and its 128 px sibling.
 *
 * `upsert: false` on both, which together with a fresh uuid per upload is what
 * makes an overwrite impossible: an existing key is an error, not a silent
 * replacement, so no request can ever clobber an object another one still
 * points at.
 *
 * `contentType` is the sniffed mime rather than the browser's claim, and
 * `cacheControl` is one day — the Free plan cannot purge the CDN quickly, so a
 * moderated photo must not linger for a year.
 *
 * When the thumbnail fails, the full object is removed again before throwing.
 * Half an avatar is worse than none: `avatarPath` has not been written yet, so
 * without that cleanup the full object would be unreferenced from the first
 * moment it existed.
 *
 * The paths are built here with the same `buildAvatarPaths` the caller uses, so
 * the two cannot disagree about where these bytes went.
 */
export async function putAvatarObjects({
  userId,
  objectId,
  ext,
  mime,
  full,
  thumb,
}: PutAvatarObjectsInput): Promise<void> {
  const paths = buildAvatarPaths(userId, objectId, ext);
  const bucket = createSupabaseAdminClient().storage.from(AVATAR_BUCKET);
  const options = {
    contentType: mime,
    cacheControl: String(AVATAR_CACHE_CONTROL_SECONDS),
    upsert: false,
  };

  const fullUpload = await bucket.upload(paths.full, full, options);
  if (fullUpload.error) {
    throw storageFailed("full", fullUpload.error.message);
  }

  const thumbUpload = await bucket.upload(paths.thumb, thumb, options);
  if (thumbUpload.error) {
    await removeAvatarObjects([paths.full]);
    throw storageFailed("thumb", thumbUpload.error.message);
  }
}

/**
 * Best-effort delete. Never throws, and never names a path.
 *
 * Every caller is already past the point of no return — the object is either
 * unreferenced (a lost compare-and-swap) or the row that referenced it has
 * already been updated — so a failure here leaves an orphan, not a broken
 * avatar, and reporting it to the person would describe a problem that is not
 * theirs. Operators still learn about it: the count goes to the log.
 *
 * Paths are deliberately kept out of the log line. A path names a user id, and
 * platform logs are a wider audience than `AuditLog`.
 */
export async function removeAvatarObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  try {
    const bucket = createSupabaseAdminClient().storage.from(AVATAR_BUCKET);
    const { error } = await bucket.remove(paths);
    if (error) {
      console.error(`[avatar-storage] remove refused for ${paths.length} object(s)`);
    }
  } catch {
    console.error(`[avatar-storage] remove threw for ${paths.length} object(s)`);
  }
}

/**
 * `system` severity, so the upload failure is recorded and the person gets a
 * reference to quote. `detail` is admin-only and never reaches the browser,
 * which is the one place the storage service's own words are allowed.
 */
function storageFailed(which: "full" | "thumb", reason: string): AppError {
  return new AppError("AVATAR_STORAGE_FAILED", {
    detail: `${which} avatar upload failed: ${reason}`,
    context: { object: which },
  });
}
