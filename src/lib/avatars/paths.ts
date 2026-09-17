/**
 * Avatar object key shapes and the one place that builds a public URL for one.
 *
 * Pure, no `server-only` — the display component (`UserAvatar`) runs on the
 * client and needs `avatarPublicUrl` directly.
 */

import { AVATAR_BUCKET } from "./limits";

export type AvatarExt = "webp" | "jpg" | "png";

export type AvatarPaths = {
  full: string;
  thumb: string;
};

/**
 * Mirrors the DB CHECK constraint on `User.avatarPath`:
 * `^[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$`
 *
 * Only the *full* object path has this shape and is what gets stored in the
 * column; the thumbnail path is always derived with `thumbPathFor`.
 */
const AVATAR_PATH_PATTERN =
  /^([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webp|jpg|png)$/;

/**
 * `<userId>/<uuid>_128.<ext>` — the thumbnail sits next to the full object,
 * distinguished only by the `_128` suffix before the extension.
 */
export function thumbPathFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return `${path}_128`;
  return `${path.slice(0, dot)}_128${path.slice(dot)}`;
}

/** Builds the full and thumbnail object paths for a freshly generated object id. */
export function buildAvatarPaths(
  userId: string,
  objectId: string,
  ext: AvatarExt
): AvatarPaths {
  const full = `${userId}/${objectId}.${ext}`;
  return { full, thumb: thumbPathFor(full) };
}

/**
 * True when `path` has the exact stored shape and — when `userId` is given —
 * belongs to that user. Rejects `..`, backslashes, and a leading slash
 * explicitly, on top of what the regex already excludes, because the shape
 * of this check is what stands between a crafted path and another tenant's
 * storage prefix.
 */
export function isValidAvatarPath(path: string, userId?: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..") || path.includes("\\") || path.startsWith("/")) {
    return false;
  }

  const match = AVATAR_PATH_PATTERN.exec(path);
  if (!match) return false;

  const owner = match[1];
  if (userId !== undefined && owner !== userId) return false;

  return true;
}

/**
 * The only place `/storage/v1/object/public` appears under `src/`.
 *
 * Returns null when `base` is missing or `path` does not have the stored
 * shape — callers fall back to initials rather than requesting a broken URL.
 * The default parameter reads the env var literally so Next inlines it into
 * client bundles at build time.
 */
export function avatarPublicUrl(
  path: string,
  variant: "full" | "thumb",
  base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): string | null {
  if (!base) return null;
  if (!isValidAvatarPath(path)) return null;

  const target = variant === "thumb" ? thumbPathFor(path) : path;
  const trimmedBase = base.replace(/\/+$/, "");
  const encodedPath = target
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${trimmedBase}/storage/v1/object/public/${AVATAR_BUCKET}/${encodedPath}`;
}
