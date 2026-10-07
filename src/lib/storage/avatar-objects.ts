import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AVATAR_CACHE_CONTROL_SECONDS } from "@/lib/avatars/limits";
import { buildAvatarPaths, type AvatarExt } from "@/lib/avatars/paths";
import type { AvatarMime } from "@/lib/avatars/sniff";
import { AppError } from "@/lib/errors/app-error";

/**
 * The only writer of the avatar bucket (Cloudflare R2, binding `AVATARS`,
 * bucket `litrack-avatars`).
 *
 * `server-only`: the bucket has no client-facing write path, so every byte
 * that lands there passed through `validateAvatarUpload` first. Reads are
 * public through the bucket's custom domain (`NEXT_PUBLIC_AVATAR_BASE_URL`),
 * never through this module. See docs/better-auth-migration.md section 5.
 */

/** The slice of the Workers R2 binding this module uses. */
type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

type PutAvatarObjectsInput = {
  userId: string;
  /** Freshly generated `crypto.randomUUID()`. Never reused. */
  objectId: string;
  ext: AvatarExt;
  /** The SNIFFED type, never the one the browser claimed. */
  mime: AvatarMime;
  full: Uint8Array;
  thumb: Uint8Array;
};

/**
 * The `AVATARS` binding, or null when there is none (plain `next dev`, Node
 * tests, a request outside a Workers context).
 */
function avatarBucket(): R2BucketLike | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { AVATARS?: R2BucketLike }).AVATARS ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload the full-size object and its 128 px sibling.
 *
 * A fresh uuid per upload is what makes an overwrite impossible: no request
 * ever writes a key another one still points at.
 *
 * `contentType` is the sniffed mime rather than the browser's claim, and
 * `cacheControl` is one day — a moderated photo must not linger in the CDN.
 *
 * When the thumbnail fails, the full object is removed again before throwing.
 * Half an avatar is worse than none: `avatarPath` has not been written yet, so
 * without that cleanup the full object would be unreferenced from the first
 * moment it existed.
 *
 * The keys are built with the same `buildAvatarPaths` the caller uses, so the
 * two cannot disagree about where these bytes went.
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
  const bucket = avatarBucket();
  if (!bucket) {
    throw new AppError("AVATAR_STORAGE_FAILED", {
      detail: "avatar upload failed: CONFIG_MISSING (R2 binding AVATARS is not available)",
      context: { object: "full" },
    });
  }
  const options = {
    httpMetadata: {
      contentType: mime,
      cacheControl: `public, max-age=${AVATAR_CACHE_CONTROL_SECONDS}`,
    },
  };

  try {
    await bucket.put(paths.full, full, options);
  } catch (err) {
    throw storageFailed("full", err);
  }

  try {
    await bucket.put(paths.thumb, thumb, options);
  } catch (err) {
    await removeAvatarObjects([paths.full]);
    throw storageFailed("thumb", err);
  }
}

/**
 * Best-effort delete. Never throws, and never names a key.
 *
 * Every caller is already past the point of no return — the object is either
 * unreferenced (a lost compare-and-swap) or the row that referenced it has
 * already been updated — so a failure here leaves an orphan, not a broken
 * avatar, and reporting it to the person would describe a problem that is not
 * theirs. Operators still learn about it: the count goes to the log.
 *
 * Keys are kept out of the log line. A key names a user id, and platform logs
 * are a wider audience than `AuditLog`.
 */
export async function removeAvatarObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  try {
    const bucket = avatarBucket();
    if (!bucket) {
      console.error(`[avatar-storage] remove skipped, no R2 binding, ${paths.length} object(s)`);
      return;
    }
    await bucket.delete(paths);
  } catch {
    console.error(`[avatar-storage] remove threw for ${paths.length} object(s)`);
  }
}

/**
 * `system` severity, so the upload failure is recorded and the person gets a
 * reference to quote. `detail` is admin-only and never reaches the browser.
 */
function storageFailed(which: "full" | "thumb", err: unknown): AppError {
  const reason = err instanceof Error ? err.message : "unknown error";
  return new AppError("AVATAR_STORAGE_FAILED", {
    detail: `${which} avatar upload failed: ${reason}`,
    context: { object: which },
  });
}
