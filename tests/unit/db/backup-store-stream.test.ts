import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `saveBackupStream` is the upload half of the memory bound: it must hold one
 * part at a time, upload parts in order, only publish the file on completion,
 * and never publish a file whose producer failed midway.
 */

const put = vi.fn();
const createMultipartUpload = vi.fn();
const uploadPart = vi.fn();
const completeMultipartUpload = vi.fn();
const list = vi.fn();
const del = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => put(...a),
  createMultipartUpload: (...a: unknown[]) => createMultipartUpload(...a),
  uploadPart: (...a: unknown[]) => uploadPart(...a),
  completeMultipartUpload: (...a: unknown[]) => completeMultipartUpload(...a),
  list: (...a: unknown[]) => list(...a),
  del: (...a: unknown[]) => del(...a),
  get: vi.fn(),
}));

process.env.BLOB_READ_WRITE_TOKEN = "test-token";
const { saveBackupStream, UPLOAD_PART_BYTES } = await import("@/lib/db/backup-store");

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

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ blobs: [] });
  createMultipartUpload.mockResolvedValue({ key: "k", uploadId: "u" });
  uploadPart.mockImplementation(async (_p: string, _b: unknown, o: { partNumber: number }) => ({
    etag: `e${o.partNumber}`,
    partNumber: o.partNumber,
  }));
  completeMultipartUpload.mockResolvedValue({ pathname: "p" });
  put.mockResolvedValue({ pathname: "p" });
});

describe("streaming backup upload", () => {
  it("sends a backup smaller than one part as a single private put", async () => {
    const saved = await saveBackupStream("daily", bytesStream([100, 200]), { stamp: "2026-09-26" });

    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = put.mock.calls[0];
    expect(pathname).toBe("litrack/backups/daily/2026-09-26.ndjson.gz");
    expect((body as ArrayBuffer).byteLength).toBe(300);
    expect(options).toMatchObject({ access: "private", allowOverwrite: true, addRandomSuffix: false });
    expect(createMultipartUpload).not.toHaveBeenCalled();
    expect(saved.size).toBe(300);
  });

  it("uploads parts in order as they fill, then completes", async () => {
    const half = UPLOAD_PART_BYTES / 2;
    // 2.5 parts' worth of bytes, in half-part chunks.
    await saveBackupStream("weekly", bytesStream([half, half, half, half, half]), { stamp: "2026-09-26" });

    expect(uploadPart.mock.calls.map((c) => (c[1] as ArrayBuffer).byteLength)).toEqual([
      UPLOAD_PART_BYTES,
      UPLOAD_PART_BYTES,
      half,
    ]);
    expect(uploadPart.mock.calls.map((c) => c[2].partNumber)).toEqual([1, 2, 3]);
    expect(completeMultipartUpload).toHaveBeenCalledWith(
      "litrack/backups/weekly/2026-09-26.ndjson.gz",
      [
        { etag: "e1", partNumber: 1 },
        { etag: "e2", partNumber: 2 },
        { etag: "e3", partNumber: 3 },
      ],
      expect.objectContaining({ key: "k", uploadId: "u", access: "private" })
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("never completes, puts or prunes when the snapshot fails midway", async () => {
    const half = UPLOAD_PART_BYTES / 2;
    await expect(
      saveBackupStream("daily", bytesStream([half, half, half, half], 3), { stamp: "2026-09-26" })
    ).rejects.toThrow("database went away");

    // The part that filled was uploaded, but without completion nothing
    // replaces the file already in the slot.
    expect(completeMultipartUpload).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("prunes the slot only after a successful write", async () => {
    list.mockResolvedValue({
      blobs: ["2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"].map((d, i) => ({
        pathname: `litrack/backups/daily/${d}.ndjson.gz`,
        size: 1,
        uploadedAt: new Date(Date.UTC(2026, 8, 26 - i)),
      })),
    });
    await saveBackupStream("daily", bytesStream([10]), { stamp: "2026-09-26" });
    expect(del).toHaveBeenCalledWith(["litrack/backups/daily/2026-09-23.ndjson.gz"]);
  });
});

describe("restore's safety snapshot", () => {
  it("can be written without pruning, so the undo point being restored survives", async () => {
    list.mockResolvedValue({
      blobs: [
        { pathname: "litrack/backups/safety/old.ndjson.gz", size: 1, uploadedAt: new Date(0) },
      ],
    });
    await saveBackupStream("safety", bytesStream([10]), { stamp: "new", prune: false });
    expect(put).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
