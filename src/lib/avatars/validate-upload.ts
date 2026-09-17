/**
 * Server-side validation of the two re-encoded avatar objects (full + thumb)
 * a client uploads. Stored bytes are validated here regardless of what the
 * client claims — the bucket's own limits are only a backstop. Pure, no
 * `server-only`.
 */

import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_FULL_MAX_DIMENSION,
  AVATAR_FULL_MIN_DIMENSION,
  AVATAR_THUMB_MAX_BYTES,
  AVATAR_THUMB_MAX_DIMENSION,
  AVATAR_THUMB_MIN_DIMENSION,
} from "./limits";
import { sniffImage, type AvatarMime } from "./sniff";
import type { AvatarExt } from "./paths";

export type ValidateAvatarUploadInput = {
  full: Uint8Array;
  thumb: Uint8Array;
};

export type ValidateAvatarUploadResult =
  | { ok: true; mime: AvatarMime; ext: AvatarExt }
  | { ok: false; reason: "invalid" | "too_large" };

const EXT_BY_MIME: Record<AvatarMime, AvatarExt> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function validateAvatarUpload({
  full,
  thumb,
}: ValidateAvatarUploadInput): ValidateAvatarUploadResult {
  const fullInfo = sniffImage(full);
  const thumbInfo = sniffImage(thumb);
  if (!fullInfo || !thumbInfo) return { ok: false, reason: "invalid" };

  if (fullInfo.mime !== thumbInfo.mime) return { ok: false, reason: "invalid" };
  if (fullInfo.hasMetadata || thumbInfo.hasMetadata) return { ok: false, reason: "invalid" };
  if (fullInfo.animated || thumbInfo.animated) return { ok: false, reason: "invalid" };
  if (fullInfo.width !== fullInfo.height) return { ok: false, reason: "invalid" };
  if (thumbInfo.width !== thumbInfo.height) return { ok: false, reason: "invalid" };

  if (full.byteLength > AVATAR_FULL_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (
    fullInfo.width < AVATAR_FULL_MIN_DIMENSION ||
    fullInfo.width > AVATAR_FULL_MAX_DIMENSION
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (thumb.byteLength > AVATAR_THUMB_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (
    thumbInfo.width < AVATAR_THUMB_MIN_DIMENSION ||
    thumbInfo.width > AVATAR_THUMB_MAX_DIMENSION
  ) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, mime: fullInfo.mime, ext: EXT_BY_MIME[fullInfo.mime] };
}
