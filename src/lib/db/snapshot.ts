import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma, prismaFresh } from "@/lib/prisma";
import { saveBackupStream, type BackupKind, type StoredBackup } from "@/lib/db/backup-store";
import {
  DELETE_ORDER,
  OPERATIONAL_DELETE_ORDER,
  redactSnapshotRows,
  SNAPSHOT_MODELS,
  SNAPSHOT_SCOPE,
  TEACHER_GRADES_JOIN,
  WRITE_ORDER,
} from "@/lib/db/schema-order";
import {
  decodeBackupBytes,
  keysetKeysFor,
  keysetOrderBy,
  keysetWhere,
  readSnapshotEvents,
  sniffFormat,
  snapshotLines,
  SnapshotFormatError,
  TEACHER_GRADES_SECTION,
  type Row,
  type SnapshotFooter,
  type SnapshotSource,
} from "@/lib/db/snapshot-format";

/**
 * Logical snapshots of the whole database.
 *
 * Not `pg_dump`: that binary does not exist on a Worker, so a snapshot here is
 * every row of every snapshot-scoped table read through Prisma and written as
 * gzipped NDJSON (format v2, see `@/lib/db/snapshot-format`). The practical
 * consequences, all of which the UI states plainly:
 *
 *  - It captures data, not schema. Restoring into a database whose migrations
 *    have moved on since the snapshot will fail on the changed table rather
 *    than silently write half a restore.
 *  - It streams. Rows are read `SNAPSHOT_BATCH_ROWS` at a time by keyset
 *    pagination, serialised, gzipped and uploaded in parts as they go, so peak
 *    memory is one batch plus one upload part whatever the database size. v1
 *    built the whole dataset in memory and could not run on a 128 MB isolate
 *    (error 1102). Restore reads the same way, inserting per chunk inside one
 *    transaction.
 *  - `AuditLog` stays out (`inSnapshot: false` in schema-order.ts). Streaming
 *    would now fit it, but a restore that rewrote the audit trail would erase
 *    the record of the restore itself, and v1 files never carried it.
 *  - It is not a point-in-time copy: tables are read one after another, so a
 *    write landing mid-backup can leave a child row whose parent was read
 *    before it existed. A restore of such a file fails on the foreign key and
 *    rolls back — loud, not partial. The cron runs at midnight Manila time for
 *    that reason.
 *  - Supabase's own PITR remains the real disaster-recovery tool. This exists
 *    for the operations an admin performs deliberately: reset, restore, undo.
 */

/** The v1 format's version. v1 files are still read; nothing writes them. */
const LEGACY_SNAPSHOT_VERSION = 1;

/**
 * Rows per read. Sets the memory bound (a page of Prisma objects plus its
 * NDJSON text — a few MB) and the query count (one per page; at `maxUses: 1`
 * each query on Workers is a fresh Hyperdrive connection and a subrequest).
 */
const SNAPSHOT_BATCH_ROWS = 2_000;

/**
 * Refuse rather than attempt a snapshot this in-app backup was not designed
 * for. Memory no longer scales with it, but restore still writes everything in
 * one transaction, and a backup that cannot be restored is the dangerous kind.
 */
const MAX_SNAPSHOT_ROWS = 500_000;

/** Prisma rejects `createMany` payloads past a few thousand rows on some drivers. */
const INSERT_CHUNK = 1_000;

/**
 * Restore deletes and re-inserts every table and now also downloads and parses
 * the file inside the transaction. Generous, because aborting a legitimate
 * restore at the default 5s would roll it back for nothing.
 */
const RESTORE_TX = { timeout: 240_000, maxWait: 20_000 } as const;

export type SnapshotCounts = Record<string, number>;

/** v1 header. */
export type SnapshotMeta = {
  version: number;
  /** ISO-8601, UTC. */
  takenAt: string;
  /** Latest applied migration when taken — a restore refuses across a mismatch. */
  migration: string | null;
  counts: SnapshotCounts;
  totalRows: number;
};

/** A whole v1 snapshot, as parsed from a legacy `.json.gz` file. */
export type Snapshot = {
  meta: SnapshotMeta;
  /** Model name → rows, scalars only. */
  data: Record<string, Record<string, unknown>[]>;
  /** Implicit m2m join rows: `{ a: gradeLevelId, b: userId }`. */
  teacherGrades: { a: string; b: string }[];
};

/** Prisma client indexed by delegate name; the delegates we use share a shape. */
type Delegate = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
  deleteMany: (args?: unknown) => Promise<{ count: number }>;
  count: (args?: unknown) => Promise<number>;
};

function delegateFor(client: PrismaClient | Prisma.TransactionClient, key: string): Delegate {
  const d = (client as unknown as Record<string, Delegate>)[key];
  if (!d || typeof d.findMany !== "function") {
    // Only reachable if SNAPSHOT_MODELS names a delegate that does not exist —
    // i.e. a typo or a renamed model. Better here than as a null deref midway
    // through a restore that has already emptied half the database.
    throw new Error(`Unknown Prisma delegate "${key}" in SNAPSHOT_MODELS`);
  }
  return d;
}

const DELEGATE_BY_MODEL = new Map(SNAPSHOT_MODELS.map((m) => [m.model, m.delegate]));

function delegateKeyFor(model: string): string {
  const key = DELEGATE_BY_MODEL.get(model);
  if (!key) throw new Error(`No Prisma delegate for snapshot model "${model}"`);
  return key;
}

/**
 * Field names of one scalar type per model, from the DMMF.
 *
 * JSON has no date type, so every `DateTime` comes back from a snapshot as a
 * string and has to be revived before Prisma will accept it. Deriving the field
 * list from the DMMF rather than sniffing values matters: a string field that
 * merely looks like a date (and `Learner` has free-text fields that could) must
 * not be silently converted into one.
 */
const fieldCache = new Map<string, { dates: string[]; json: string[] }>();

function fieldsFor(model: string): { dates: string[]; json: string[] } {
  let hit = fieldCache.get(model);
  if (!hit) {
    const dm = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
    const scalars = dm?.fields.filter((f) => f.kind === "scalar") ?? [];
    hit = {
      dates: scalars.filter((f) => f.type === "DateTime").map((f) => f.name),
      json: scalars.filter((f) => f.type === "Json").map((f) => f.name),
    };
    fieldCache.set(model, hit);
  }
  return hit;
}

/**
 * Turn a row read back from JSON into something `createMany` accepts.
 *
 * Dates are revived (see above). A `null` in a nullable `Json` column must be
 * written as `Prisma.DbNull`: Prisma refuses a bare `null` there, so without
 * this any `ErrorEvent` with no context made the whole restore fail.
 */
function reviveRows(model: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const { dates, json } = fieldsFor(model);
  if (dates.length === 0 && json.length === 0) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const f of dates) {
      const v = next[f];
      if (typeof v === "string") next[f] = new Date(v);
    }
    for (const f of json) {
      if (next[f] === null) next[f] = Prisma.DbNull;
    }
    return next;
  });
}

/** The most recently applied migration, or null if the table is unreadable. */
async function currentMigration(): Promise<string | null> {
  try {
    const rows = await prismaFresh.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? null;
  } catch {
    // Never block a backup on this — it is a guard rail for restore, not the
    // point of the operation.
    return null;
  }
}

/**
 * Where a snapshot's rows come from: Prisma, one keyset page at a time.
 *
 * `prismaFresh`, not `prisma`: on Cloudflare the default binding serves reads
 * from Hyperdrive's query cache, which may be a minute stale, and a cron run
 * is neither a Server Action nor a browser that just wrote, so it would get
 * the cached one. A backup has to be of the data, not of a cache of it.
 */
function prismaSource(client: PrismaClient): SnapshotSource {
  const { table, a, b } = TEACHER_GRADES_JOIN;
  return {
    fetchPage(model, after, take) {
      const keys = keysetKeysFor(model);
      return delegateFor(client, delegateKeyFor(model)).findMany({
        where: keysetWhere(keys, after),
        orderBy: keysetOrderBy(keys),
        take,
      });
    },
    fetchTeacherGrades(after, take) {
      // Raw SQL: the implicit join table has no delegate. `(A, B)` is its
      // unique index, so the row-value comparison is an index range scan.
      return after
        ? client.$queryRawUnsafe<{ a: string; b: string }[]>(
            `SELECT "${a}" AS a, "${b}" AS b FROM "${table}" WHERE ("${a}", "${b}") > ($1, $2) ORDER BY "${a}", "${b}" LIMIT $3`,
            after.a,
            after.b,
            take
          )
        : client.$queryRawUnsafe<{ a: string; b: string }[]>(
            `SELECT "${a}" AS a, "${b}" AS b FROM "${table}" ORDER BY "${a}", "${b}" LIMIT $1`,
            take
          );
    },
    redact: redactSnapshotRows,
  };
}

/** A pull-driven byte stream over a text generator: nothing is read until asked for. */
function textStream<R>(
  gen: AsyncGenerator<string, R>,
  onDone: (result: R) => void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const r = await gen.next();
        if (r.done) {
          onDone(r.value);
          controller.close();
        } else {
          controller.enqueue(encoder.encode(r.value));
        }
      },
      async cancel() {
        await gen.return(undefined as never);
      },
    },
    // Zero: `pull` runs only when the consumer reads, so a slow upload stops
    // the database reads instead of letting pages pile up in the queue.
    { highWaterMark: 0 }
  );
}

export type BackupResult = {
  saved: StoredBackup;
  takenAt: string;
  totalRows: number;
};

/**
 * Take a snapshot and stream it into the `kind` slot of the backup store.
 *
 * Replaces v1's `createSnapshot()` + `saveBackup()`, which built the whole
 * snapshot as one object first. Rows are logged nowhere; only counts leave
 * this function.
 */
export async function backUpDatabase(
  kind: BackupKind,
  options: { prune?: boolean } = {}
): Promise<BackupResult> {
  const total = await countAllRows();
  if (total > MAX_SNAPSHOT_ROWS) {
    throw new Error(
      `Refusing to snapshot ${total.toLocaleString()} rows — over the ${MAX_SNAPSHOT_ROWS.toLocaleString()} row ceiling this in-app backup is designed for. Use Supabase's own backups for a database this size.`
    );
  }

  const takenAt = new Date().toISOString();
  const migration = await currentMigration();

  let footer: SnapshotFooter | null = null;
  const text = textStream(
    snapshotLines(prismaSource(prismaFresh), { takenAt, migration }, SNAPSHOT_BATCH_ROWS),
    (result) => {
      footer = result;
    }
  );
  const gzipped = text.pipeThrough(
    new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>
  );

  const saved = await saveBackupStream(kind, gzipped, { prune: options.prune });

  // Unreachable unless the stream closed without the generator finishing, in
  // which case the file has no footer and restore would refuse it anyway.
  const done = footer as SnapshotFooter | null;
  if (!done) throw new Error("Snapshot stream ended before its footer was written");

  return { saved, takenAt, totalRows: done.totalRows };
}

export async function countAllRows(): Promise<number> {
  let total = 0;
  // SNAPSHOT_SCOPE, not every model: this guards the size of the snapshot, and
  // counting a table the snapshot does not carry would trip the ceiling over
  // rows that are never read.
  for (const { delegate } of SNAPSHOT_SCOPE) {
    total += await delegateFor(prismaFresh, delegate).count({});
  }
  return total;
}

/** Per-table row counts as they stand right now. */
export async function currentCounts(): Promise<SnapshotCounts> {
  const counts: SnapshotCounts = {};
  for (const { model, delegate } of SNAPSHOT_MODELS) {
    counts[model] = await delegateFor(prisma, delegate).count({});
  }
  return counts;
}

/**
 * Validate a parsed v1 snapshot before anything destructive happens.
 *
 * Returns an error string rather than throwing so callers can surface it as a
 * refusal. The migration check is a warning the caller decides about, not a
 * hard stop, because restoring an older snapshot onto a newer schema is exactly
 * what an admin recovering from a bad deploy wants to do; a *newer* snapshot
 * onto an older schema is the one that cannot work.
 */
export function validateSnapshot(value: unknown): { ok: true; snapshot: Snapshot } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "That file is not a LITRACK backup." };
  }
  const candidate = value as Partial<Snapshot>;
  if (!candidate.meta || typeof candidate.meta !== "object") {
    return { ok: false, error: "That file is missing its backup header." };
  }
  if (candidate.meta.version !== LEGACY_SNAPSHOT_VERSION) {
    return {
      ok: false,
      error: `That backup is format version ${String(candidate.meta.version)}; this app reads versions 1 and 2.`,
    };
  }
  if (!candidate.data || typeof candidate.data !== "object") {
    return { ok: false, error: "That backup has no data section." };
  }

  // SNAPSHOT_SCOPE: a backup is not incomplete for lacking a table snapshots
  // deliberately skip. Older files that still carry one are accepted and the
  // extra section is ignored on restore, because WRITE_ORDER never reads it.
  const missing = SNAPSHOT_SCOPE.filter((m) => !Array.isArray(candidate.data?.[m.model])).map(
    (m) => m.model
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `That backup is missing tables this app expects: ${missing.join(", ")}. Restoring it would leave the database incomplete.`,
    };
  }

  return {
    ok: true,
    snapshot: {
      meta: candidate.meta as SnapshotMeta,
      data: candidate.data as Snapshot["data"],
      teacherGrades: Array.isArray(candidate.teacherGrades) ? candidate.teacherGrades : [],
    },
  };
}

// ── Restore ───────────────────────────────────────────────────────────────

/**
 * Opens a fresh byte stream over one backup, or null when it is gone. Called
 * once to validate and once to restore, so it must re-open, not hand back the
 * same stream.
 */
export type BackupOpener = () => Promise<ReadableStream<Uint8Array> | null>;

export type InspectedBackup =
  | { ok: true; format: 2; takenAt: string; totalRows: number }
  | { ok: true; format: 1; takenAt: string; snapshot: Snapshot }
  | { ok: false; error: string };

async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const r = await gen.next();
    if (r.done) return r.value;
  }
}

/**
 * Read a backup end to end and decide whether it can be restored — before the
 * safety snapshot, before any delete.
 *
 * v2 is checked line by line without keeping rows, so this costs one row of
 * memory. v1 is one JSON document and has to be parsed whole; that is the old
 * format's cost and the reason nothing writes it any more.
 *
 * Returns null when the backup is not in storage. A file that is not a valid
 * backup is `{ ok: false }` with a message safe to show; anything else (a
 * network failure reading the blob) throws.
 */
export async function inspectBackup(open: BackupOpener): Promise<InspectedBackup | null> {
  const stream = await open();
  if (!stream) return null;

  // One try around every step, the sniff included: a stored blob with bad
  // gzip or invalid UTF-8 surfaces as a SnapshotFormatError from the decoder,
  // and that is the file's problem — a refusal for the admin, not a system
  // failure with an alert. A failed read of the blob itself is not converted
  // (decodeBackupBytes rethrows it as it was) and still throws.
  try {
    const { format, chunks } = await sniffFormat(decodeBackupBytes(stream));

    if (format === "legacy") {
      let text = "";
      for await (const chunk of chunks) text += chunk;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: "That file is not a LITRACK backup." };
      }
      const check = validateSnapshot(parsed);
      if (!check.ok) return check;
      return { ok: true, format: 1, takenAt: check.snapshot.meta.takenAt, snapshot: check.snapshot };
    }

    const summary = await drain(readSnapshotEvents(chunks));
    return { ok: true, format: 2, takenAt: summary.header.takenAt, totalRows: summary.totalRows };
  } catch (err) {
    if (err instanceof SnapshotFormatError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Delete everything a restore replaces. Children first; the join table before both its sides. */
async function emptySnapshotTables(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`DELETE FROM "${TEACHER_GRADES_JOIN.table}"`);
  for (const { delegate } of DELETE_ORDER) {
    await delegateFor(tx, delegate).deleteMany({});
  }
}

async function insertTeacherGrades(tx: Prisma.TransactionClient, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const params: string[] = [];
  const values = rows.map((row, i) => {
    if (typeof row.a !== "string" || typeof row.b !== "string") {
      throw new SnapshotFormatError("That backup has a malformed teacher-grade link; the file is damaged.");
    }
    params.push(row.a, row.b);
    return `($${2 * i + 1}, $${2 * i + 2})`;
  });
  const { table, a, b } = TEACHER_GRADES_JOIN;
  return tx.$executeRawUnsafe(`INSERT INTO "${table}" ("${a}", "${b}") VALUES ${values.join(", ")}`, ...params);
}

/** Insert one chunk; returns the rows the database reports it wrote. */
async function insertChunk(tx: Prisma.TransactionClient, model: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  if (model === TEACHER_GRADES_SECTION) return insertTeacherGrades(tx, rows);
  const { count } = await delegateFor(tx, delegateKeyFor(model)).createMany({ data: reviveRows(model, rows) });
  return count;
}

/**
 * Replace the entire contents of every snapshot table with a backup's.
 *
 * One transaction: either the database ends up as the backup described it, or
 * it is untouched. A partial restore is the single worst outcome this feature
 * could produce, so there is no chunk-by-chunk commit and no "continue on
 * error" path. For v2 the file is streamed inside the transaction and re-checked
 * as it goes; a file that turns out short or inconsistent throws before the
 * commit, which rolls every delete and insert back.
 */
export async function restoreBackup(
  inspected: Extract<InspectedBackup, { ok: true }>,
  open: BackupOpener
): Promise<SnapshotCounts> {
  if (inspected.format === 1) return restoreSnapshot(inspected.snapshot);

  const stream = await open();
  if (!stream) throw new Error("The backup disappeared between validation and restore");

  const written: SnapshotCounts = {};
  await prisma.$transaction(async (tx) => {
    await emptySnapshotTables(tx);

    const events = readSnapshotEvents(decodeBackupBytes(stream));
    let pending: Row[] = [];
    let inserted = 0;
    try {
      for (;;) {
        // `.next()` rather than `for await`: the generator's return value is
        // `finish()`, the completeness check, and it must run before commit.
        const r = await events.next();
        if (r.done) break;
        const ev = r.value;
        if (ev.type === "tableStart") {
          pending = [];
          inserted = 0;
        } else if (ev.type === "row" && ev.restorable) {
          pending.push(ev.row);
          if (pending.length >= INSERT_CHUNK) {
            inserted += await insertChunk(tx, ev.model, pending);
            pending = [];
          }
        } else if (ev.type === "tableEnd") {
          if (ev.restorable) {
            inserted += await insertChunk(tx, ev.model, pending);
            // The database's own count, not the file's. They can only differ
            // if a write was silently dropped, and a restore that is short a
            // row must not commit.
            if (inserted !== ev.count) {
              throw new Error(
                `Restore wrote ${inserted} of ${ev.count} ${ev.model} rows; rolling back`
              );
            }
            if (ev.model !== TEACHER_GRADES_SECTION) written[ev.model] = inserted;
          }
          pending = [];
        }
      }
    } finally {
      // An insert that throws leaves the reader mid-file; returning it
      // cancels the blob download instead of leaving it open.
      await events.return(undefined as never).catch(() => {});
    }
  }, RESTORE_TX);

  return written;
}

/** Restore a parsed v1 snapshot. Same single-transaction contract as `restoreBackup`. */
export async function restoreSnapshot(snapshot: Snapshot): Promise<SnapshotCounts> {
  const written: SnapshotCounts = {};

  await prisma.$transaction(async (tx) => {
    await emptySnapshotTables(tx);

    for (const { model } of WRITE_ORDER) {
      const rows = snapshot.data[model] ?? [];
      written[model] = rows.length;
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await insertChunk(tx, model, rows.slice(i, i + INSERT_CHUNK));
      }
    }

    for (let i = 0; i < snapshot.teacherGrades.length; i += INSERT_CHUNK) {
      await insertTeacherGrades(tx, snapshot.teacherGrades.slice(i, i + INSERT_CHUNK));
    }
  }, RESTORE_TX);

  return written;
}

/**
 * Empty the operational tables, keeping schools, school years, grade levels,
 * sections and every user account.
 *
 * The join table survives: teacher-to-grade assignments are structure, not
 * records, and a school that loses them has to be rebuilt by hand.
 *
 * With `schoolId` given, only that school's rows go. Each table is filtered by
 * its own `schoolScope` rather than left to `ON DELETE CASCADE`, so the counts
 * returned are the rows this call actually deleted and no other school is
 * touched even by a table that reaches its school through three relations.
 */
export async function clearOperationalData(schoolId?: string | null): Promise<SnapshotCounts> {
  const removed: SnapshotCounts = {};

  await prisma.$transaction(
    async (tx) => {
      for (const { model, delegate, schoolScope } of OPERATIONAL_DELETE_ORDER) {
        if (schoolId && !schoolScope) {
          // Unreachable while the schema-order test holds: it asserts every
          // operational model carries a scope. Refusing beats silently
          // emptying this table for every school.
          throw new Error(`No school scope for operational model "${model}"`);
        }
        const where = schoolId ? schoolScope!(schoolId) : {};
        const { count } = await delegateFor(tx, delegate).deleteMany({ where });
        removed[model] = count;
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  return removed;
}
