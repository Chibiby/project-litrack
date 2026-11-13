import { describe, expect, it, vi } from "vitest";
import { r2List, r2SaveStream, type R2BucketLike } from "@/lib/db/backup-store-r2";
import { PartBuffer } from "@/lib/db/snapshot-format";

function bytesStream(sizes: number[], failAfter?: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (failAfter !== undefined && i === failAfter) {
        c.error(new Error("database went away"));
        return;
      }
      if (i >= sizes.length) {
        c.close();
        return;
      }
      c.enqueue(new Uint8Array(sizes[i++]));
    },
  });
}

function fakeBucket() {
  const partSizes: number[] = [];
  const upload = {
    uploadPart: vi.fn(async (n: number, b: Uint8Array) => {
      partSizes.push(b.byteLength);
      return { partNumber: n, etag: `e${n}` };
    }),
    complete: vi.fn(async () => ({})),
    abort: vi.fn(async () => {}),
  };
  const bucket = {
    put: vi.fn(async () => ({})),
    createMultipartUpload: vi.fn(async () => upload),
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };
  return { bucket: bucket as unknown as R2BucketLike & typeof bucket, upload, partSizes };
}

describe("PartBuffer.takeExact", () => {
  it("cuts exactly n bytes and keeps the rest", () => {
    const b = new PartBuffer(4);
    b.push(new Uint8Array([1, 2, 3]));
    b.push(new Uint8Array([4, 5, 6]));
    expect(Array.from(b.takeExact(4))).toEqual([1, 2, 3, 4]);
    expect(b.buffered).toBe(2);
    expect(Array.from(b.take())).toEqual([5, 6]);
  });
});

describe("R2 backup upload", () => {
  it("sends a small backup as one put", async () => {
    const { bucket } = fakeBucket();
    const size = await r2SaveStream(bucket, "k", bytesStream([10, 20]), 100);
    expect(size).toBe(30);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("uploads equal-sized parts, a shorter last part, then completes", async () => {
    const { bucket, upload, partSizes } = fakeBucket();
    await r2SaveStream(bucket, "k", bytesStream([70, 70, 70, 15]), 100);
    expect(partSizes).toEqual([100, 100, 25]);
    expect(upload.complete).toHaveBeenCalledWith([
      { partNumber: 1, etag: "e1" },
      { partNumber: 2, etag: "e2" },
      { partNumber: 3, etag: "e3" },
    ]);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("aborts the upload and never completes when the producer fails", async () => {
    const { bucket, upload } = fakeBucket();
    await expect(r2SaveStream(bucket, "k", bytesStream([150, 10], 1), 100)).rejects.toThrow(
      "database went away",
    );
    expect(upload.abort).toHaveBeenCalledTimes(1);
    expect(upload.complete).not.toHaveBeenCalled();
  });
});

describe("R2 backup listing", () => {
  it("follows the cursor across pages", async () => {
    const { bucket } = fakeBucket();
    const day = new Date("2026-11-01T00:00:00Z");
    bucket.list
      .mockResolvedValueOnce({ objects: [{ key: "a", size: 1, uploaded: day }], truncated: true, cursor: "c" })
      .mockResolvedValueOnce({ objects: [{ key: "b", size: 2, uploaded: day }], truncated: false });
    const rows = await r2List(bucket, "litrack/backups/");
    expect(rows.map((r) => r.pathname)).toEqual(["a", "b"]);
    expect(bucket.list).toHaveBeenLastCalledWith({ prefix: "litrack/backups/", cursor: "c" });
  });
});
