import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { del, get, list, put } from "@vercel/blob";
import type { Snapshot } from "@/lib/db/snapshot";

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

function pathFor(kind: BackupKind, stamp: string): string {
  return `${ROOT}/${kind}/${stamp}.json.gz`;
}

function parsePath(pathname: string): { kind: BackupKind; stamp: string } | null {
  const m = pathname.match(/^litrack\/backups\/(daily|weekly|safety)\/(.+)\.json\.gz$/);
  if (!m) return null;
  return { kind: m[1] as BackupKind, stamp: m[2] };
}

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

/**
 * Write a snapshot into its slot, then drop whatever falls off the end.
 *
 * Pruning happens after the write, never before: losing the oldest backup to
 * make room for one that then fails to upload would spend a good backup on
 * nothing.
 */
export async function saveBackup(
  kind: BackupKind,
  snapshot: Snapshot,
  stamp: string = kind === "safety" ? new Date().toISOString().replace(/[:.]/g, "-") : localDayStamp()
): Promise<StoredBackup> {
  if (!isBackupStoreConfigured()) throw new Error(BACKUP_STORE_SETUP_MESSAGE);

  const body = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"));
  const pathname = pathFor(kind, stamp);

  const result = await put(pathname, body, {
    access: "private",
    // Same-day re-runs replace the day's file rather than accumulating beside
    // it — "new backups override old" applies within a slot as well as across.
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
  });

  await pruneKind(kind);

  return {
    kind,
    stamp,
    pathname: result.pathname,
    size: body.byteLength,
    uploadedAt: new Date(),
  };
}

/** Delete everything past `RETENTION[kind]`, oldest first. */
export async function pruneKind(kind: BackupKind): Promise<string[]> {
  const existing = await listBackups(kind);
  const doomed = existing.slice(RETENTION[kind]);
  if (doomed.length === 0) return [];
  await del(doomed.map((b) => b.pathname));
  return doomed.map((b) => b.pathname);
}

/** Read one backup back. Returns null when the blob is gone. */
export async function readBackup(pathname: string): Promise<Snapshot | null> {
  if (!isBackupStoreConfigured()) throw new Error(BACKUP_STORE_SETUP_MESSAGE);
  if (!parsePath(pathname)) {
    // Restore takes a pathname from the client. Anything not matching the
    // backup layout must not become a blob read against an arbitrary path.
    throw new Error("Not a backup path");
  }

  // `useCache: false` — a restore must read the bytes that are actually stored,
  // not a CDN copy of a blob that was overwritten minutes ago at the same path.
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;

  const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
  return JSON.parse(gunzipSync(buf).toString("utf8")) as Snapshot;
}

/** Raw gzip bytes, for the authenticated download route. */
export async function readBackupBytes(pathname: string): Promise<Buffer | null> {
  if (!isBackupStoreConfigured()) throw new Error(BACKUP_STORE_SETUP_MESSAGE);
  if (!parsePath(pathname)) throw new Error("Not a backup path");

  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
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

/** Parse an uploaded `.json` or `.json.gz` backup file. */
export function parseUploadedBackup(bytes: Buffer): unknown {
  // gzip magic number. Accepting both shapes means an admin can hand back
  // exactly the file they downloaded, or one they unzipped to look inside.
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = (isGzip ? gunzipSync(bytes) : bytes).toString("utf8");
  return JSON.parse(text);
}
