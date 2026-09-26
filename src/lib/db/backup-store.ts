import "server-only";
import {
  completeMultipartUpload,
  createMultipartUpload,
  del,
  get,
  list,
  put,
  uploadPart,
  type Part,
} from "@vercel/blob";
import { PartBuffer } from "@/lib/db/snapshot-format";

/**
 * Where automatic backups live, and how they rotate.
 *
 * Vercel Blob rather than a table inside Postgres: a backup stored in the
 * database it backs up only survives the failures that leave the database
 * intact, which is the smaller half of what backups are for.
 *
 * Every blob is written `access: 'private'`. These files contain the full
 * learner roster of every school — names, birthdates, addresses. A public blob
 * URL is unauthenticated and unguessable only by obscurity, which is not a
 * control. Downloads go through an authenticated route that streams the bytes
 * server-side; the blob URL itself is never handed to a browser.
 */

const ROOT = "litrack/backups";

export type BackupKind = "daily" | "weekly" | "safety";

/**
 * How many of each kind survive a prune.
 *
 * Three dailies and one weekly is the requested shape: on the 7th, the dailies
 * hold the 6th, 5th and 4th. `safety` keeps exactly one — it is the undo point
 * for the last destructive operation, and an undo stack deeper than one would
 * imply a history the restore path cannot actually walk back through.
 */
export const RETENTION: Record<BackupKind, number> = {
  daily: 3,
  weekly: 1,
  safety: 1,
};

export type StoredBackup = {
  kind: BackupKind;
  pathname: string;
  size: number;
  uploadedAt: Date;
  /** `YYYY-MM-DD` for daily/weekly, an ISO instant for safety. */
  stamp: string;
};

export function isBackupStoreConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export const BACKUP_STORE_SETUP_MESSAGE =
  "Backup storage is not connected. Add a Vercel Blob store to this project and set BLOB_READ_WRITE_TOKEN, then reload this page.";

/** `YYYY-MM-DD` in Asia/Manila, so a "daily" backup matches the local school day. */
export function localDayStamp(at: Date = new Date()): string {
  // The app keys attendance off local dates for the same reason (see
  // src/lib/date-keys.ts): UTC rolls the day over at 08:00 Manila time, which
  // would file the morning's backup under the previous day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * New backups are v2 (gzipped NDJSON, see `@/lib/db/snapshot-format`) and are
 * named `.ndjson.gz`. `.json.gz` is the v1 name, still listed, downloadable and
 * restorable — restore decides the format from the content, never the name.
 */
function pathFor(kind: BackupKind, stamp: string): string {
  return `${ROOT}/${kind}/${stamp}.ndjson.gz`;
}

export function parseBackupPath(pathname: string): { kind: BackupKind; stamp: string } | null {
  const m = pathname.match(/^litrack\/backups\/(daily|weekly|safety)\/([^/]+?)\.(?:nd)?json\.gz$/);
  if (!m) return null;
  return { kind: m[1] as BackupKind, stamp: m[2] };
}

const parsePath = parseBackupPath;

/**
 * Compressed bytes per multipart part. Vercel Blob requires every part but the
 * last to be at least 5 MB; 8 MiB leaves margin. This is also the upload side's
 * whole memory cost — one part, briefly two while it is concatenated.
 */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/** Newest first. */
export async function listBackups(kind?: BackupKind): Promise<StoredBackup[]> {
  if (!isBackupStoreConfigured()) return [];
  const prefix = kind ? `${ROOT}/${kind}/` : `${ROOT}/`;
  const { blobs } = await list({ prefix });

  return blobs
    .map((b) => {
      const parsed = parsePath(b.pathname);
      if (!parsed) return null;
      return {
        kind: parsed.kind,
        stamp: parsed.stamp,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
      } satisfies StoredBackup;
    })
    .filter((b): b is StoredBackup => b !== null)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

function defaultStamp(kind: BackupKind): string {
  return kind === "safety" ? new Date().toISOString().replace(/[:.]/g, "-") : localDayStamp();
}

/** `ArrayBuffer` view of exactly these bytes, which is a type the Blob SDK accepts. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

/**
 * Stream an already-compressed backup into its slot, then drop whatever falls
 * off the end.
 *
 * The bytes are uploaded as they arrive, one `UPLOAD_PART_BYTES` part at a
 * time, so however large the backup is, this holds one part. A backup that
 * ends before the first part fills goes up in a single `put` instead — one
 * request rather than three.
 *
 * The file only appears at `pathname` when `completeMultipartUpload` runs.
 * A failure midway (the database dropping, the Worker hitting a limit) leaves
 * the previous file in the slot untouched, which is the property that makes a
 * same-day overwrite safe.
 *
 * A failure after the first part has been uploaded leaves that multipart
 * upload's parts orphaned in the store: `@vercel/blob` 2.8 has no abort call.
 * They are not listed, cannot be downloaded, and do not replace any file, but
 * they are storage the store still holds.
 *
 * Pruning happens after the write, never before: losing the oldest backup to
 * make room for one that then fails to upload would spend a good backup on
 * nothing.
 */
export type SaveBackupOptions = {
  /** Defaults to today's Manila date, or an instant for `safety`. */
  stamp?: string;
  /**
   * False to keep every older file of this kind for now. Restore sets it: its
   * safety snapshot must not prune the undo point it is about to restore
   * from. The caller then runs `pruneKind` once it is done with that file.
   */
  prune?: boolean;
};

export async function saveBackupStream(
  kind: BackupKind,
  body: ReadableStream<Uint8Array>,
  options: SaveBackupOptions = {}
): Promise<StoredBackup> {
  const stamp = options.stamp ?? defaultStamp(kind);
  const prune = options.prune ?? true;
  if (!isBackupStoreConfigured()) throw new Error(BACKUP_STORE_SETUP_MESSAGE);

  const pathname = pathFor(kind, stamp);
  const blobOptions = {
    access: "private",
    // Same-day re-runs replace the day's file rather than accumulating beside
    // it — "new backups override old" applies within a slot as well as across.
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
  } as const;

  const buffer = new PartBuffer(UPLOAD_PART_BYTES);
  const parts: Part[] = [];
  let upload: { key: string; uploadId: string } | null = null;
  let size = 0;

  const flushPart = async () => {
    const bytes = buffer.take();
    upload ??= await createMultipartUpload(pathname, blobOptions);
    // Sequential: a parallel upload would need a second part in memory, which
    // is the read-ahead this function exists to avoid.
    parts.push(
      await uploadPart(pathname, asArrayBuffer(bytes), { ...blobOptions, ...upload, partNumber: parts.length + 1 })
    );
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      buffer.push(value);
      if (buffer.hasFullPart()) await flushPart();
    }
  } catch (err) {
    // Stop the producer — it is holding a database page and would otherwise
    // keep reading tables for a backup that can no longer be written.
    await reader.cancel(err).catch(() => {});
    throw err;
  }

  if (upload) {
    if (buffer.buffered > 0) await flushPart();
    await completeMultipartUpload(pathname, parts, { ...blobOptions, ...(upload as { key: string; uploadId: string }) });
  } else {
    await put(pathname, asArrayBuffer(buffer.take()), blobOptions);
  }

  if (prune) await pruneKind(kind);

  return { kind, stamp, pathname, size, uploadedAt: new Date() };
}

/** Delete everything past `RETENTION[kind]`, oldest first. */
export async function pruneKind(kind: BackupKind): Promise<string[]> {
  const existing = await listBackups(kind);
  const doomed = existing.slice(RETENTION[kind]);
  if (doomed.length === 0) return [];
  await del(doomed.map((b) => b.pathname));
  return doomed.map((b) => b.pathname);
}

/**
 * The stored bytes of one backup, as a stream. Null when the blob is gone.
 *
 * A stream and not a buffer: both callers (restore, and the download route)
 * must work on a file bigger than the isolate. Each call is a fresh read, so
 * restore can open the same backup twice — once to validate, once to write.
 */
export async function openBackupStream(
  pathname: string
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null> {
  if (!isBackupStoreConfigured()) throw new Error(BACKUP_STORE_SETUP_MESSAGE);
  if (!parsePath(pathname)) {
    // Restore and download take a pathname from the client. Anything not
    // matching the backup layout must not become a blob read against an
    // arbitrary path.
    throw new Error("Not a backup path");
  }

  // `useCache: false` — a restore must read the bytes that are actually stored,
  // not a CDN copy of a blob that was overwritten minutes ago at the same path.
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return { stream: result.stream, size: result.blob.size };
}

export async function deleteBackup(pathname: string): Promise<void> {
  if (!parsePath(pathname)) throw new Error("Not a backup path");
  await del(pathname);
}

/** The single undo point, or null when nothing destructive has run. */
export async function latestSafetyBackup(): Promise<StoredBackup | null> {
  const [newest] = await listBackups("safety");
  return newest ?? null;
}
