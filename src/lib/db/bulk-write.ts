import "server-only";

/**
 * Shared knobs for this repo's bulk-write paths.
 *
 * Every `$transaction` in this codebase used to inherit Prisma's defaults — a 5 s
 * `timeout` and a 2 s `maxWait`. Those are sized for a transaction of two or three
 * statements against a database in the same region. The bulk-write paths are
 * neither: they carry a whole grid or a whole CSV, and the Postgres instance is
 * cross-Pacific from the school, so a single round trip costs on the order of
 * 220 ms. A per-row statement loop therefore blew the 5 s budget at roughly a
 * dozen rows and surfaced as `P2028`.
 *
 * The rewrites those paths now use are set-based, so the round-trip count is a
 * handful rather than one-per-row. These numbers are deliberately far larger than
 * the resulting expected duration: the cost of an over-generous timeout is a slow
 * request that still succeeds, and the cost of a tight one is a lost grid save.
 */
export const BULK_TX_OPTIONS = {
  /** Wall clock the transaction may hold open once it has a connection. */
  timeout: 30_000,
  /** How long to wait for a pooler connection before giving up. */
  maxWait: 10_000,
} as const;

/**
 * Rows per statement.
 *
 * Postgres caps a single statement at 65535 bind parameters. The widest row this
 * repo writes in bulk is a `Learner` at roughly 25 columns, so 100 rows is about
 * 2500 parameters — two orders of magnitude of headroom, while still keeping the
 * number of round trips in single digits at every path's payload cap.
 */
export const BULK_CHUNK_ROWS = 100;

/** `Learner` is the widest bulk row; kept explicit so it can diverge if it grows. */
export const IMPORT_CHUNK_ROWS = BULK_CHUNK_ROWS;

/** Split `rows` into consecutive chunks of at most `size`. Never yields empty. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
