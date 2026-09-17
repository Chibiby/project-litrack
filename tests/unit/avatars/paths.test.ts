import { describe, expect, it } from "vitest";
import {
  avatarPublicUrl,
  buildAvatarPaths,
  isValidAvatarPath,
  thumbPathFor,
} from "@/lib/avatars/paths";

const USER_ID = "user-123";
const UUID = "0b8f4f2e-1c3a-4d5e-9a6b-7c8d9e0f1a2b";

describe("buildAvatarPaths / thumbPathFor", () => {
  it("builds a full path prefixed by the user id and a matching thumb path", () => {
    const paths = buildAvatarPaths(USER_ID, UUID, "webp");
    expect(paths.full).toBe(`${USER_ID}/${UUID}.webp`);
    expect(paths.thumb).toBe(`${USER_ID}/${UUID}_128.webp`);
  });

  it("inserts the _128 suffix immediately before the extension", () => {
    expect(thumbPathFor(`${USER_ID}/${UUID}.jpg`)).toBe(`${USER_ID}/${UUID}_128.jpg`);
    expect(thumbPathFor(`${USER_ID}/${UUID}.png`)).toBe(`${USER_ID}/${UUID}_128.png`);
  });
});

describe("isValidAvatarPath", () => {
  it("accepts a well-formed path for each allowed extension", () => {
    for (const ext of ["webp", "jpg", "png"]) {
      expect(isValidAvatarPath(`${USER_ID}/${UUID}.${ext}`)).toBe(true);
    }
  });

  it("accepts a path that belongs to the given userId", () => {
    expect(isValidAvatarPath(`${USER_ID}/${UUID}.webp`, USER_ID)).toBe(true);
  });

  it("rejects a path that belongs to a different user's prefix", () => {
    expect(isValidAvatarPath(`${USER_ID}/${UUID}.webp`, "someone-else")).toBe(false);
  });

  it("rejects an uppercase UUID", () => {
    expect(isValidAvatarPath(`${USER_ID}/${UUID.toUpperCase()}.webp`)).toBe(false);
  });

  it("rejects an unsupported extension", () => {
    expect(isValidAvatarPath(`${USER_ID}/${UUID}.gif`)).toBe(false);
  });

  it("rejects a path containing ..", () => {
    expect(isValidAvatarPath(`../${UUID}.webp`)).toBe(false);
    expect(isValidAvatarPath(`${USER_ID}/../${UUID}.webp`)).toBe(false);
  });

  it("rejects a path containing a backslash", () => {
    expect(isValidAvatarPath(`${USER_ID}\\${UUID}.webp`)).toBe(false);
  });

  it("rejects a path with a leading slash", () => {
    expect(isValidAvatarPath(`/${USER_ID}/${UUID}.webp`)).toBe(false);
  });

  it("rejects a path with no slash at all", () => {
    expect(isValidAvatarPath(`${UUID}.webp`)).toBe(false);
  });

  it("rejects a malformed uuid segment", () => {
    expect(isValidAvatarPath(`${USER_ID}/not-a-uuid.webp`)).toBe(false);
  });
});

describe("avatarPublicUrl", () => {
  const path = `${USER_ID}/${UUID}.webp`;

  it("returns null when base is missing", () => {
    expect(avatarPublicUrl(path, "full", "")).toBeNull();
    expect(avatarPublicUrl(path, "full", undefined)).toBeNull();
  });

  it("returns null when the path is invalid", () => {
    expect(avatarPublicUrl("not-a-valid-path", "full", "https://proj.supabase.co")).toBeNull();
  });

  it("builds the full-variant URL", () => {
    expect(avatarPublicUrl(path, "full", "https://proj.supabase.co")).toBe(
      `https://proj.supabase.co/storage/v1/object/public/avatars/${USER_ID}/${UUID}.webp`
    );
  });

  it("builds the thumb-variant URL with the _128 suffix", () => {
    expect(avatarPublicUrl(path, "thumb", "https://proj.supabase.co")).toBe(
      `https://proj.supabase.co/storage/v1/object/public/avatars/${USER_ID}/${UUID}_128.webp`
    );
  });

  it("strips a trailing slash from base", () => {
    expect(avatarPublicUrl(path, "full", "https://proj.supabase.co/")).toBe(
      `https://proj.supabase.co/storage/v1/object/public/avatars/${USER_ID}/${UUID}.webp`
    );
  });
});
