import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avatarPublicUrl, buildAvatarPaths } from "@/lib/avatars/paths";

/**
 * `src/lib/storage/avatar-objects.ts` against a fake R2 `AVATARS` binding.
 *
 * The binding is the only thing faked (via `getCloudflareContext`); key
 * building, content type, cache control and error mapping all run for real.
 */

const USER_ID = "user-abc";
const OBJECT_ID = "0b8f4f2e-1c3a-4d5e-9a6b-7c8d9e0f1a2b";

type Put = (key: string, value: Uint8Array, options?: unknown) => Promise<unknown>;
type Del = (keys: string | string[]) => Promise<void>;

const put = vi.fn<Put>();
const del = vi.fn<Del>();
let hasBinding: boolean;
let contextThrows: boolean;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (contextThrows) throw new Error("getCloudflareContext called outside a request");
    return { env: hasBinding ? { AVATARS: { put, delete: del } } : {} };
  },
}));

const { putAvatarObjects, removeAvatarObjects } = await import("@/lib/storage/avatar-objects");

const full = new Uint8Array([1, 2, 3]);
const thumb = new Uint8Array([9, 8]);

beforeEach(() => {
  vi.clearAllMocks();
  hasBinding = true;
  contextThrows = false;
  put.mockResolvedValue({});
  del.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("putAvatarObjects", () => {
  it("writes the full object then the thumbnail under the keys buildAvatarPaths gives, bytes passed through", async () => {
    await putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "png", mime: "image/png", full, thumb });

    const paths = buildAvatarPaths(USER_ID, OBJECT_ID, "png");
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][0]).toBe(`${USER_ID}/${OBJECT_ID}.png`);
    expect(put.mock.calls[0][0]).toBe(paths.full);
    expect(put.mock.calls[0][1]).toBe(full);
    expect(put.mock.calls[1][0]).toBe(`${USER_ID}/${OBJECT_ID}_128.png`);
    expect(put.mock.calls[1][1]).toBe(thumb);
  });

  it("sets the content type from the sniffed mime it was given, on both objects", async () => {
    await putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "jpg", mime: "image/jpeg", full, thumb });
    for (const call of put.mock.calls) {
      expect(call[2]).toMatchObject({ httpMetadata: { contentType: "image/jpeg" } });
    }

    put.mockClear();
    await putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "webp", mime: "image/webp", full, thumb });
    for (const call of put.mock.calls) {
      expect(call[2]).toMatchObject({ httpMetadata: { contentType: "image/webp" } });
    }
  });

  it("sets a one-day public cache-control", async () => {
    await putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "webp", mime: "image/webp", full, thumb });
    for (const call of put.mock.calls) {
      expect(call[2]).toMatchObject({
        httpMetadata: { cacheControl: "public, max-age=86400" },
      });
    }
  });

  it("surfaces a failed full upload as AVATAR_STORAGE_FAILED and never writes the thumbnail", async () => {
    put.mockRejectedValueOnce(new Error("R2 503"));

    const failure = await putAvatarObjects({
      userId: USER_ID,
      objectId: OBJECT_ID,
      ext: "webp",
      mime: "image/webp",
      full,
      thumb,
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(failure).toMatchObject({
      name: "AppError",
      code: "AVATAR_STORAGE_FAILED",
      context: { object: "full" },
    });
    expect((failure as { detail: string }).detail).toContain("R2 503");
    expect(put).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("surfaces a failed thumbnail upload and removes the full object it already wrote", async () => {
    put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("quota exceeded"));

    const failure = await putAvatarObjects({
      userId: USER_ID,
      objectId: OBJECT_ID,
      ext: "webp",
      mime: "image/webp",
      full,
      thumb,
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(failure).toMatchObject({
      code: "AVATAR_STORAGE_FAILED",
      context: { object: "thumb" },
    });
    expect((failure as { detail: string }).detail).toContain("quota exceeded");
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith([`${USER_ID}/${OBJECT_ID}.webp`]);
  });

  it("still throws the thumbnail failure when the cleanup delete also fails", async () => {
    put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("thumb down"));
    del.mockRejectedValueOnce(new Error("delete down"));

    await expect(
      putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "webp", mime: "image/webp", full, thumb })
    ).rejects.toMatchObject({ code: "AVATAR_STORAGE_FAILED", context: { object: "thumb" } });
  });

  it.each([
    ["no AVATARS binding", () => { hasBinding = false; }],
    ["no Cloudflare context", () => { contextThrows = true; }],
  ])("throws AVATAR_STORAGE_FAILED rather than pretending to store when there is %s", async (_label, arrange) => {
    arrange();

    const failure = await putAvatarObjects({
      userId: USER_ID,
      objectId: OBJECT_ID,
      ext: "webp",
      mime: "image/webp",
      full,
      thumb,
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(failure).toMatchObject({ code: "AVATAR_STORAGE_FAILED" });
    expect((failure as { detail: string }).detail).toContain("CONFIG_MISSING");
    expect(put).not.toHaveBeenCalled();
  });
});

describe("removeAvatarObjects", () => {
  it("deletes exactly the keys it is given, in one call", async () => {
    const keys = [`${USER_ID}/${OBJECT_ID}.webp`, `${USER_ID}/${OBJECT_ID}_128.webp`];
    await removeAvatarObjects(keys);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(keys);
  });

  it("does nothing for an empty list", async () => {
    await removeAvatarObjects([]);
    expect(del).not.toHaveBeenCalled();
  });

  it("never throws, and logs a count but not the key, when delete rejects", async () => {
    del.mockRejectedValueOnce(new Error("R2 down"));
    const key = `${USER_ID}/${OBJECT_ID}.webp`;

    await expect(removeAvatarObjects([key, `${USER_ID}/${OBJECT_ID}_128.webp`])).resolves.toBeUndefined();

    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("2 object(s)");
    expect(logged).not.toContain(USER_ID);
  });

  it("never throws when there is no binding", async () => {
    hasBinding = false;
    await expect(removeAvatarObjects(["a/b.webp"])).resolves.toBeUndefined();
    expect(del).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("1 object(s)");
  });
});

describe("public URL for an uploaded object", () => {
  it("is NEXT_PUBLIC_AVATAR_BASE_URL plus the same key that was put", async () => {
    vi.stubEnv("NEXT_PUBLIC_AVATAR_BASE_URL", "https://avatars.example.com/");
    try {
      await putAvatarObjects({ userId: USER_ID, objectId: OBJECT_ID, ext: "webp", mime: "image/webp", full, thumb });
      const [fullKey, thumbKey] = put.mock.calls.map((c) => c[0]);

      expect(avatarPublicUrl(fullKey, "full")).toBe(`https://avatars.example.com/${fullKey}`);
      expect(avatarPublicUrl(fullKey, "thumb")).toBe(`https://avatars.example.com/${thumbKey}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
