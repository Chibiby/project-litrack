import { describe, it, expect, beforeAll } from "vitest";
import { gzipSync } from "node:zlib";
import { SNAPSHOT_MODELS } from "@/lib/db/schema-order";

beforeAll(() => {
  // backup-store reads this at call time to decide whether it is configured.
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

async function store() {
  return import("@/lib/db/backup-store");
}

async function snapshotMod() {
  return import("@/lib/db/snapshot");
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

describe("uploaded file parsing", () => {
  it("reads a gzipped backup, which is what Download produces", async () => {
    const { parseUploadedBackup } = await store();
    const original = validSnapshotObject();
    const bytes = gzipSync(Buffer.from(JSON.stringify(original), "utf8"));

    expect(parseUploadedBackup(bytes)).toEqual(original);
  });

  it("reads a plain JSON backup, for an admin who unzipped it to look inside", async () => {
    const { parseUploadedBackup } = await store();
    const original = validSnapshotObject();

    expect(parseUploadedBackup(Buffer.from(JSON.stringify(original), "utf8"))).toEqual(original);
  });

  it("throws on a file that is neither", async () => {
    const { parseUploadedBackup } = await store();
    expect(() => parseUploadedBackup(Buffer.from("not json at all", "utf8"))).toThrow();
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
