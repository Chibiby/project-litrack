import { describe, it, expect, beforeAll } from "vitest";
import { gzipSync } from "node:zlib";
import { SNAPSHOT_MODELS } from "@/lib/db/schema-order";

beforeAll(() => {
  // backup-store reads this at call time to decide whether it is configured.
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

// Loaded once at collection rather than inside the first test: the snapshot
// module pulls in Prisma and the Blob SDK, and on a busy machine that first
// load alone could exceed a test's 5s timeout.
const storeModule = await import("@/lib/db/backup-store");
const snapshotModule = await import("@/lib/db/snapshot");

async function store() {
  return storeModule;
}

async function snapshotMod() {
  return snapshotModule;
}

/** A structurally valid snapshot: every model present, even if empty. */
function validSnapshotObject(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown[]> = {};
  for (const m of SNAPSHOT_MODELS) data[m.model] = [];
  return {
    meta: {
      version: 1,
      takenAt: "2026-09-07T00:00:00.000Z",
      migration: "20260907000001_password_is_school_id",
      counts: {},
      totalRows: 0,
    },
    data,
    teacherGrades: [],
    ...overrides,
  };
}

describe("snapshot validation", () => {
  it("accepts a well-formed snapshot", async () => {
    const { validateSnapshot } = await snapshotMod();
    const result = validateSnapshot(validSnapshotObject());
    expect(result.ok).toBe(true);
  });

  it("refuses a snapshot missing a table rather than restoring a partial database", async () => {
    const { validateSnapshot } = await snapshotMod();
    const snapshot = validSnapshotObject();
    delete (snapshot.data as Record<string, unknown>).Learner;

    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Learner");
  });

  it("refuses a snapshot from a future format version", async () => {
    const { validateSnapshot } = await snapshotMod();
    const result = validateSnapshot(validSnapshotObject({ meta: { version: 99 } }));
    expect(result.ok).toBe(false);
  });

  it("refuses files that are not backups at all", async () => {
    const { validateSnapshot } = await snapshotMod();
    for (const junk of [null, undefined, 42, "a string", {}, { meta: {} }]) {
      expect(validateSnapshot(junk).ok, `should refuse ${JSON.stringify(junk)}`).toBe(false);
    }
  });

  it("tolerates a snapshot with no teacherGrades key", async () => {
    const { validateSnapshot } = await snapshotMod();
    const snapshot = validSnapshotObject();
    delete (snapshot as Record<string, unknown>).teacherGrades;

    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.teacherGrades).toEqual([]);
  });
});

/** An opener over fixed bytes, re-openable like a stored blob or an uploaded File. */
function opener(bytes: Uint8Array | string) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return async () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(data);
        c.close();
      },
    });
}

/**
 * v1 files predate streaming but are still in storage and on admins' disks,
 * so restore must keep reading them — gzipped (what Download produced) or
 * plain (unzipped to look inside). The format is decided from content.
 */
describe("legacy v1 backups", () => {
  it("reads a gzipped v1 backup", async () => {
    const { inspectBackup } = await snapshotMod();
    const original = validSnapshotObject();
    const result = await inspectBackup(opener(gzipSync(Buffer.from(JSON.stringify(original), "utf8"))));

    expect(result).toMatchObject({ ok: true, format: 1, takenAt: original.meta.takenAt });
  });

  it("reads a plain JSON v1 backup", async () => {
    const { inspectBackup } = await snapshotMod();
    const result = await inspectBackup(opener(JSON.stringify(validSnapshotObject())));
    expect(result).toMatchObject({ ok: true, format: 1 });
  });

  it("refuses a file that is neither, with a message it is safe to show", async () => {
    const { inspectBackup } = await snapshotMod();
    const result = await inspectBackup(opener("not json at all"));
    expect(result).toEqual({ ok: false, error: "That file is not a LITRACK backup." });
  });

  it("refuses a v1 backup missing a table before anything is deleted", async () => {
    const { inspectBackup } = await snapshotMod();
    const snapshot = validSnapshotObject();
    delete (snapshot.data as Record<string, unknown>).Learner;
    const result = await inspectBackup(opener(JSON.stringify(snapshot)));
    expect(result).toMatchObject({ ok: false });
  });

  it("returns null when the backup is not in storage", async () => {
    const { inspectBackup } = await snapshotMod();
    await expect(inspectBackup(async () => null)).resolves.toBeNull();
  });
});

describe("backup paths", () => {
  it("accepts the v2 and the v1 file names, and nothing outside the layout", async () => {
    const { parseBackupPath } = await store();
    expect(parseBackupPath("litrack/backups/daily/2026-09-26.ndjson.gz")).toEqual({
      kind: "daily",
      stamp: "2026-09-26",
    });
    expect(parseBackupPath("litrack/backups/weekly/2026-09-20.json.gz")).toEqual({
      kind: "weekly",
      stamp: "2026-09-20",
    });
    for (const bad of [
      "litrack/backups/daily/../../secrets.json.gz",
      "litrack/backups/monthly/2026-09-26.ndjson.gz",
      "other/2026-09-26.ndjson.gz",
      "litrack/backups/daily/2026-09-26.ndjson",
    ]) {
      expect(parseBackupPath(bad), bad).toBeNull();
    }
  });
});

describe("retention", () => {
  it("keeps 3 daily, 1 weekly and 1 undo point", async () => {
    const { RETENTION } = await store();
    expect(RETENTION).toEqual({ daily: 3, weekly: 1, safety: 1 });
  });
});

describe("day stamping", () => {
  it("stamps by Manila date, not UTC", async () => {
    const { localDayStamp } = await store();
    // 23:30 UTC on the 6th is already 07:30 on the 7th in Manila. Stamping in
    // UTC would file this backup under the wrong school day and let the next
    // morning's run overwrite it instead of rotating.
    expect(localDayStamp(new Date("2026-09-06T23:30:00.000Z"))).toBe("2026-09-07");
    expect(localDayStamp(new Date("2026-09-06T15:00:00.000Z"))).toBe("2026-09-06");
  });

  it("produces stamps that sort chronologically as strings", async () => {
    const { localDayStamp } = await store();
    const days = [
      localDayStamp(new Date("2026-09-04T02:00:00.000Z")),
      localDayStamp(new Date("2026-09-05T02:00:00.000Z")),
      localDayStamp(new Date("2026-09-06T02:00:00.000Z")),
    ];
    expect([...days].sort()).toEqual(days);
  });
});
