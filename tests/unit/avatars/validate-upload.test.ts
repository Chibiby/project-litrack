import { describe, expect, it } from "vitest";
import { validateAvatarUpload } from "@/lib/avatars/validate-upload";
import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_THUMB_MAX_BYTES,
} from "@/lib/avatars/limits";
import { buildJpeg, buildPng, buildWebpVp8 } from "./fixtures";

function validFull(padToBytes?: number) {
  return buildJpeg({ width: 512, height: 512, padToBytes });
}

function validThumb() {
  return buildJpeg({ width: 128, height: 128 });
}

describe("validateAvatarUpload", () => {
  it("accepts a matching, well-formed pair", () => {
    const result = validateAvatarUpload({ full: validFull(), thumb: validThumb() });
    expect(result).toEqual({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  it("maps each accepted mime to its extension", () => {
    expect(
      validateAvatarUpload({
        full: buildWebpVp8({ width: 256, height: 256 }),
        thumb: buildWebpVp8({ width: 128, height: 128 }),
      })
    ).toEqual({ ok: true, mime: "image/webp", ext: "webp" });

    expect(
      validateAvatarUpload({
        full: buildPng({ width: 256, height: 256 }),
        thumb: buildPng({ width: 128, height: 128 }),
      })
    ).toEqual({ ok: true, mime: "image/png", ext: "png" });
  });

  it("accepts a full object exactly at the byte ceiling", () => {
    const full = validFull(AVATAR_FULL_MAX_BYTES);
    expect(full.byteLength).toBe(AVATAR_FULL_MAX_BYTES);
    const result = validateAvatarUpload({ full, thumb: validThumb() });
    expect(result.ok).toBe(true);
  });

  it("rejects a full object one byte over the ceiling as too_large", () => {
    const full = validFull(AVATAR_FULL_MAX_BYTES + 1);
    expect(full.byteLength).toBe(AVATAR_FULL_MAX_BYTES + 1);
    const result = validateAvatarUpload({ full, thumb: validThumb() });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects a thumb object over its byte ceiling as too_large", () => {
    const thumb = buildJpeg({ width: 128, height: 128, padToBytes: AVATAR_THUMB_MAX_BYTES + 1 });
    const result = validateAvatarUpload({ full: validFull(), thumb });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects when sniffing either file fails", () => {
    const notAnImage = Uint8Array.from(Array.from("not an image", (c) => c.charCodeAt(0)));
    expect(validateAvatarUpload({ full: notAnImage, thumb: validThumb() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(validateAvatarUpload({ full: validFull(), thumb: notAnImage })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a mismatched mime between full and thumb", () => {
    const result = validateAvatarUpload({
      full: validFull(),
      thumb: buildPng({ width: 128, height: 128 }),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects metadata on either file", () => {
    expect(
      validateAvatarUpload({
        full: buildJpeg({ width: 512, height: 512, exif: true }),
        thumb: validThumb(),
      })
    ).toEqual({ ok: false, reason: "invalid" });

    expect(
      validateAvatarUpload({
        full: validFull(),
        thumb: buildJpeg({ width: 128, height: 128, xmp: true }),
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an animated file", () => {
    const result = validateAvatarUpload({
      full: buildPng({ width: 512, height: 512, acTL: true }),
      thumb: buildPng({ width: 128, height: 128 }),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a non-square full image", () => {
    const result = validateAvatarUpload({
      full: buildJpeg({ width: 512, height: 256 }),
      thumb: validThumb(),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a non-square thumb image", () => {
    const result = validateAvatarUpload({
      full: validFull(),
      thumb: buildJpeg({ width: 128, height: 64 }),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a full image below the minimum dimension", () => {
    const result = validateAvatarUpload({
      full: buildJpeg({ width: 100, height: 100 }),
      thumb: validThumb(),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a thumb image above the maximum dimension", () => {
    const result = validateAvatarUpload({
      full: validFull(),
      thumb: buildJpeg({ width: 300, height: 300 }),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
