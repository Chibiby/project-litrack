import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RateLimitOptions, RateLimitResult } from "@/lib/rate-limit";

/**
 * Shared rate-limit window in Cloudflare D1 (binding `RATE_LIMIT_D1`, database
 * `litrack-rate-limit`, table `rl_hits`). The production backend when Upstash
 * is not configured: unlike the in-memory window it is shared by every
 * isolate, so a retry loop spread across isolates is still counted.
 *
 * Table (created once with `wrangler d1 execute`, see docs/runbook.md):
 *   CREATE TABLE rl_hits (key TEXT NOT NULL, ts INTEGER NOT NULL);
 *   CREATE INDEX rl_hits_key_ts ON rl_hits (key, ts);
 *
 * Every function returns null on any failure (no binding, D1 error), so the
 * caller falls back to the in-memory window. A limiter never throws.
 */

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
};
type D1Result = { results?: Record<string, unknown>[] };
export type D1Like = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
};

/** Rows older than this are swept from every key now and then. */
const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;
/** About one call in 200 sweeps old rows, so the table stays small. */
const SWEEP_CHANCE = 1 / 200;

function bindingDb(): D1Like | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { RATE_LIMIT_D1?: D1Like }).RATE_LIMIT_D1 ?? null;
  } catch {
    return null;
  }
}

function readWindow(result: D1Result | undefined): { count: number; oldest: number | null } | null {
  const row = result?.results?.[0];
  if (!row) return null;
  const count = Number(row.c);
  if (!Number.isFinite(count)) return null;
  const oldest = row.oldest == null ? null : Number(row.oldest);
  return { count, oldest: oldest !== null && Number.isFinite(oldest) ? oldest : null };
}

function overLimit(oldest: number | null, now: number, windowMs: number): RateLimitResult {
  const anchor = oldest ?? now;
  return { ok: false, retryAfterMs: Math.max(0, anchor + windowMs - now) };
}

/**
 * Record an attempt and read the window, in one transactional batch. Like the
 * Redis path, rejected attempts are recorded too, so hammering keeps the
 * caller locked out until they back off for a full window.
 */
export async function d1Check(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number,
  db: D1Like | null = bindingDb(),
  random: () => number = Math.random,
): Promise<RateLimitResult | null> {
  if (!db) return null;
  try {
    const statements = [
      db.prepare("INSERT INTO rl_hits (key, ts) VALUES (?, ?)").bind(key, now),
      db.prepare("DELETE FROM rl_hits WHERE key = ? AND ts <= ?").bind(key, now - windowMs),
      db.prepare("SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM rl_hits WHERE key = ?").bind(key),
    ];
    if (random() < SWEEP_CHANCE) {
      statements.push(db.prepare("DELETE FROM rl_hits WHERE ts < ?").bind(now - SWEEP_AGE_MS));
    }
    const results = await db.batch(statements);
    const window = readWindow(results[2]);
    if (!window) return null;
    // The count includes this attempt, hence `<=` (same as the Redis path).
    if (window.count <= limit) return { ok: true, retryAfterMs: 0 };
    return overLimit(window.oldest, now, windowMs);
  } catch (err) {
    console.error("[rate-limit] D1 check failed:", err);
    return null;
  }
}

/** Read the window without recording an attempt. */
export async function d1Peek(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number,
  db: D1Like | null = bindingDb(),
): Promise<RateLimitResult | null> {
  if (!db) return null;
  try {
    const results = await db.batch([
      db.prepare("DELETE FROM rl_hits WHERE key = ? AND ts <= ?").bind(key, now - windowMs),
      db.prepare("SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM rl_hits WHERE key = ?").bind(key),
    ]);
    const window = readWindow(results[1]);
    if (!window) return null;
    // Not counted yet, hence `<`.
    if (window.count < limit) return { ok: true, retryAfterMs: 0 };
    return overLimit(window.oldest, now, windowMs);
  } catch (err) {
    console.error("[rate-limit] D1 peek failed:", err);
    return null;
  }
}
