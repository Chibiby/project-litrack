import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DELETE_ORDER,
  OPERATIONAL_DELETE_ORDER,
  SNAPSHOT_MODELS,
  TEACHER_GRADES_JOIN,
  WRITE_ORDER,
} from "@/lib/db/schema-order";

/**
 * Logical snapshots of the whole database.
 *
 * Not `pg_dump`: that binary does not exist on Vercel's runtime, so a snapshot
 * here is every row of every modelled table read through Prisma and written as
 * JSON. The practical consequences, all of which the UI states plainly:
 *
 *  - It captures data, not schema. Restoring into a database whose migrations
 *    have moved on since the snapshot will fail on the changed table rather
 *    than silently write half a restore — `SNAPSHOT_VERSION` and the recorded
 *    migration name are what let it refuse early instead.
 *  - It holds the whole dataset in memory. Fine at this app's size (low
 *    thousands of rows); `MAX_SNAPSHOT_ROWS` is the tripwire that turns
 *    "silently truncated backup" into a loud failure if that ever stops
 *    being true.
 *  - Supabase's own PITR remains the real disaster-recovery tool. This exists
 *    for the operations an admin performs deliberately: reset, restore, undo.
 */

const SNAPSHOT_VERSION = 1;

/**
 * Refuse rather than attempt a snapshot big enough to exhaust function memory.
 * A backup that OOMs halfway is indistinguishable from no backup, and the
 * dangerous case is discovering that during a restore.
 */
const MAX_SNAPSHOT_ROWS = 500_000;

/** Prisma rejects `createMany` payloads past a few thousand rows on some drivers. */
const INSERT_CHUNK = 1_000;

export type SnapshotCounts = Record<string, number>;

export type SnapshotMeta = {
  version: number;
  /** ISO-8601, UTC. */
  takenAt: string;
  /** Latest applied migration when taken — a restore refuses across a mismatch. */
  migration: string | null;
  counts: SnapshotCounts;
  totalRows: number;
};

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

/**
 * DateTime fields per model, from the DMMF.
 *
 * JSON has no date type, so every `DateTime` comes back from a snapshot as a
 * string and has to be revived before Prisma will accept it. Deriving the field
 * list from the DMMF rather than sniffing values matters: a string field that
 * merely looks like a date (and `Learner` has free-text fields that could) must
 * not be silently converted into one.
 */
function dateFieldsFor(model: string): string[] {
  const dm = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
  if (!dm) return [];
  return dm.fields.filter((f) => f.type === "DateTime" && f.kind === "scalar").map((f) => f.name);
}

function reviveDates(model: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const fields = dateFieldsFor(model);
  if (fields.length === 0) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const f of fields) {
      const v = next[f];
      if (typeof v === "string") next[f] = new Date(v);
    }
    return next;
  });
}

/** The most recently applied migration, or null if the table is unreadable. */
async function currentMigration(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
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

/** Read every modelled table into a snapshot object. */
export async function createSnapshot(): Promise<Snapshot> {
  const total = await countAllRows();
  if (total > MAX_SNAPSHOT_ROWS) {
    throw new Error(
      `Refusing to snapshot ${total.toLocaleString()} rows — over the ${MAX_SNAPSHOT_ROWS.toLocaleString()} row ceiling this in-app backup is designed for. Use Supabase's own backups for a database this size.`
    );
  }

  const data: Snapshot["data"] = {};
  const counts: SnapshotCounts = {};

  // Sequential on purpose. Parallel reads across 22 tables would open 22
  // simultaneous pooler connections against a pool floored at 3 (see
  // resolvePooledDatabaseUrl) and spend the whole backup queueing on P2024.
  for (const { model, delegate } of WRITE_ORDER) {
    const rows = await delegateFor(prisma, delegate).findMany({});
    data[model] = rows;
    counts[model] = rows.length;
  }

  const teacherGrades = await prisma.$queryRawUnsafe<{ a: string; b: string }[]>(
    `SELECT "${TEACHER_GRADES_JOIN.a}" AS a, "${TEACHER_GRADES_JOIN.b}" AS b FROM "${TEACHER_GRADES_JOIN.table}"`
  );

  return {
    meta: {
      version: SNAPSHOT_VERSION,
      takenAt: new Date().toISOString(),
      migration: await currentMigration(),
      counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0) + teacherGrades.length,
    },
    data,
    teacherGrades,
  };
}

export async function countAllRows(): Promise<number> {
  let total = 0;
  for (const { delegate } of SNAPSHOT_MODELS) {
    total += await delegateFor(prisma, delegate).count({});
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
 * Validate a parsed snapshot before anything destructive happens.
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
  if (candidate.meta.version !== SNAPSHOT_VERSION) {
    return {
      ok: false,
      error: `That backup is format version ${String(candidate.meta.version)}; this app reads version ${SNAPSHOT_VERSION}.`,
    };
  }
  if (!candidate.data || typeof candidate.data !== "object") {
    return { ok: false, error: "That backup has no data section." };
  }

  const missing = SNAPSHOT_MODELS.filter((m) => !Array.isArray(candidate.data?.[m.model])).map(
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

/**
 * Replace the entire contents of every modelled table with the snapshot's.
 *
 * One transaction: either the database ends up as the snapshot described it, or
 * it is untouched. A partial restore is the single worst outcome this feature
 * could produce, so there is no chunk-by-chunk commit and no "continue on
 * error" path.
 *
 * The timeout is generous because the whole operation is deletes and inserts
 * across 22 tables and the default 5s would abort a legitimate restore.
 */
export async function restoreSnapshot(snapshot: Snapshot): Promise<SnapshotCounts> {
  const written: SnapshotCounts = {};

  await prisma.$transaction(
    async (tx) => {
      // Children first. The join table goes before both its sides.
      await tx.$executeRawUnsafe(`DELETE FROM "${TEACHER_GRADES_JOIN.table}"`);
      for (const { delegate } of DELETE_ORDER) {
        await delegateFor(tx, delegate).deleteMany({});
      }

      for (const { model, delegate } of WRITE_ORDER) {
        const rows = reviveDates(model, snapshot.data[model] ?? []);
        written[model] = rows.length;
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          await delegateFor(tx, delegate).createMany({ data: rows.slice(i, i + INSERT_CHUNK) });
        }
      }

      for (const link of snapshot.teacherGrades) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${TEACHER_GRADES_JOIN.table}" ("${TEACHER_GRADES_JOIN.a}", "${TEACHER_GRADES_JOIN.b}") VALUES ($1, $2)`,
          link.a,
          link.b
        );
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  return written;
}

/**
 * Empty the operational tables, keeping schools, school years, grade levels,
 * sections and every user account.
 *
 * The join table survives: teacher-to-grade assignments are structure, not
 * records, and a school that loses them has to be rebuilt by hand.
 */
export async function clearOperationalData(): Promise<SnapshotCounts> {
  const removed: SnapshotCounts = {};

  await prisma.$transaction(
    async (tx) => {
      for (const { model, delegate } of OPERATIONAL_DELETE_ORDER) {
        const { count } = await delegateFor(tx, delegate).deleteMany({});
        removed[model] = count;
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  return removed;
}
