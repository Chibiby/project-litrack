/**
 * Constants shared by every avatar module and by the upload/removal actions
 * that sit on top of them (`src/lib/actions/avatar.ts`).
 *
 * Pure, no `server-only` — the crop dialog and the server both need the size
 * ceilings so the client can reject an oversized source before it ever
 * uploads. See `docs/superpowers/specs/2026-09-18-user-profile-photos-design.md`.
 */

/** Supabase Storage bucket holding every avatar object. Public, unguessable keys. */
export const AVATAR_BUCKET = "avatars";

/** Ceiling on the raw file the client lets a user pick, before it decodes it. */
export const AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024;

/** Ceiling on the re-encoded full-size object, enforced again on the server. */
export const AVATAR_FULL_MAX_BYTES = 1024 * 1024;

/** Ceiling on the re-encoded thumbnail object, enforced again on the server. */
export const AVATAR_THUMB_MAX_BYTES = 64 * 1024;

/** Output edge length, in pixels, the client re-encodes the full image to. */
export const AVATAR_FULL_SIZE = 512;

/** Output edge length, in pixels, the client re-encodes the thumbnail to. */
export const AVATAR_THUMB_SIZE = 128;

/** Accepted (square) dimension range for the full-size object, inclusive. */
export const AVATAR_FULL_MIN_DIMENSION = 128;
export const AVATAR_FULL_MAX_DIMENSION = 1024;

/** Accepted (square) dimension range for the thumbnail object, inclusive. */
export const AVATAR_THUMB_MIN_DIMENSION = 32;
export const AVATAR_THUMB_MAX_DIMENSION = 256;

/**
 * Supabase Storage `cacheControl`, in seconds (1 day). The Free plan cannot
 * purge the CDN quickly, so a moderated photo must not linger for a year.
 */
export const AVATAR_CACHE_CONTROL_SECONDS = 86400;

/** At most 10 uploads per hour per user — shape matches `RateLimitOptions`. */
export const AVATAR_UPLOAD_RATE_LIMIT = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
} as const;
