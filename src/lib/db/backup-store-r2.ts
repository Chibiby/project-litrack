import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PartBuffer } from "@/lib/db/snapshot-format";

/**
 * Cloudflare R2 half of the backup store (binding `BACKUPS`, private bucket
 * `litrack-backups`). Preferred over Vercel Blob whenever the binding exists,
 * so production backups live on the same account as the Worker. The bucket has
 * no public domain: every read goes through the authenticated download route.
 *
 * Functions take the bucket as an argument so tests can pass a fake one.
 */

type R2Object = { key: string; size: number; uploaded: Date };
type R2ListResult = { objects: R2Object[]; truncated: boolean; cursor?: string };
type R2UploadedPart = { partNumber: number; etag: string };
type R2MultipartUpload = {
  uploadPart(partNumber: number, value: Uint8Array): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
};
type PutOptions = { httpMetadata?: { contentType?: string } };

export type R2BucketLike = {
  list(options: { prefix: string; cursor?: string }): Promise<R2ListResult>;
  put(key: string, value: Uint8Array, options?: PutOptions): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(keys: string | string[]): Promise<void>;
  createMultipartUpload(key: string, options?: PutOptions): Promise<R2MultipartUpload>;
};

/** The `BACKUPS` binding, or null outside a Worker or when it is not bound. */
export function r2BackupBucket(): R2BucketLike | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { BACKUPS?: R2BucketLike }).BACKUPS ?? null;
  } catch {
    return null;
  }
}

const GZIP = { httpMetadata: { contentType: "application/gzip" } };

/** Every object under `prefix`, following the list cursor. */
export async function r2List(
  bucket: R2BucketLike,
  prefix: string,
): Promise<{ pathname: string; size: number; uploadedAt: Date }[]> {
  const out: { pathname: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, cursor });
    for (const o of page.objects) out.push({ pathname: o.key, size: o.size, uploadedAt: o.uploaded });
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

/**
 * Stream a backup into `key`, one fixed-size part at a time. R2 needs every
 * part but the last to be the same size, so a part is cut at exactly
 * `partBytes` and the rest stays buffered for the next one.
 *
 * The object only appears at `key` when the upload completes; a failure aborts
 * the upload, so the previous file in the slot is untouched and no orphaned
 * parts are left behind.
 */
export async function r2SaveStream(
  bucket: R2BucketLike,
  key: string,
  body: ReadableStream<Uint8Array>,
  partBytes: number,
): Promise<number> {
  const buffer = new PartBuffer(partBytes);
  const parts: R2UploadedPart[] = [];
  let upload: R2MultipartUpload | null = null;
  let size = 0;

  const flush = async (bytes: Uint8Array) => {
    upload ??= await bucket.createMultipartUpload(key, GZIP);
    parts.push(await upload.uploadPart(parts.length + 1, bytes));
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      buffer.push(value);
      while (buffer.hasFullPart()) await flush(buffer.takeExact(partBytes));
    }
    if (upload) {
      if (buffer.buffered > 0) await flush(buffer.take());
      await (upload as R2MultipartUpload).complete(parts);
    } else {
      await bucket.put(key, buffer.take(), GZIP);
    }
  } catch (err) {
    await reader.cancel(err).catch(() => {});
    if (upload) await (upload as R2MultipartUpload).abort().catch(() => {});
    throw err;
  }
  return size;
}
