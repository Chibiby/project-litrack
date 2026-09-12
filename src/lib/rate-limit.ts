/**
 * Sliding-window rate limiter.
 *
 * Two backends:
 *
 * 1. Redis (default when UPSTASH_REDIS_REST_URL/_TOKEN are set): a shared,
 *    cross-instance window — correct on serverless, where requests for the
 *    same key can land on different lambdas. Uses a ZSET per key with a TTL,
 *    so idle keys expire instead of accumulating.
 * 2. In-memory (fallback): a per-instance sliding window. Fine as a soft
 *    abuse ceiling on a single instance; on serverless a burst spread across
 *    cold starts or replicas can exceed the intended limit. Kept so local dev
 *    and unconfigured preview deploys still rate-limit.
 *
 * The chosen backend must never be observable as an error: every Redis
 * failure degrades to the in-memory window instead of throwing.
 */

import { upstashCommand, upstashPipeline } from "@/lib/cache/upstash";

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

export type RateLimitOptions = {
  /** Max attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  /** Milliseconds until the oldest attempt falls out of the window (0 when ok). */
  retryAfterMs: number;
};

function prune(entry: WindowEntry, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
}

/**
 * Redis sliding window for `key`. Returns null on any failure, so the caller
 * falls back to the in-memory window.
 *
 * ZADD before ZCARD means the current attempt is included in the count, hence
 * `count > limit` rather than `>=` — both backends therefore allow exactly
 * `limit` attempts per window.
 *
 * They differ once the limit is hit: Redis records rejected attempts too, so
 * continued hammering keeps sliding the window forward and the caller stays
 * locked out until they back off for a full `windowMs`. The memory path only
 * records allowed attempts, so it reopens sooner. The stricter behaviour is
 * the one that runs in production; the difference is bounded by `windowMs` and
 * only ever errs toward blocking abuse, never toward letting it through.
 */
async function redisCheck(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): Promise<RateLimitResult | null> {
  const rkey = `rl:${key}`;
  const minScore = now - windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  const replies = await upstashPipeline([
    ["ZADD", rkey, String(now), member],
    ["ZREMRANGEBYSCORE", rkey, "0", String(minScore)],
    ["ZCARD", rkey],
    ["PEXPIRE", rkey, String(windowMs)],
  ]);
  if (!replies) return null;

  const count = Number(replies[2]);
  if (!Number.isFinite(count)) return null;
  if (count <= limit) return { ok: true, retryAfterMs: 0 };

  // Over the limit: report when the oldest attempt leaves the window.
  // WITHSCORES over REST returns a flat [member, score] pair, so the score is
  // at index 1 — not a property on an object as the SDK would return.
  const oldest = await upstashCommand([
    "ZRANGE",
    rkey,
    "0",
    "0",
    "WITHSCORES",
  ]);
  const oldestScore = Array.isArray(oldest) ? Number(oldest[1]) : NaN;
  const anchor = Number.isFinite(oldestScore) ? oldestScore : now;

  return { ok: false, retryAfterMs: Math.max(0, anchor + windowMs - now) };
}

function memoryCheck(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): RateLimitResult {
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  prune(entry, now, windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    return { ok: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { ok: true, retryAfterMs: 0 };
}

/**
 * Record an attempt against `key`. Returns whether the attempt is allowed.
 *
 * Async: the Redis path is a single round-trip, awaited so the shared window is
 * authoritative. Falls back to the per-instance window when Redis is
 * unavailable — a limiter must never become a point of failure.
 */
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();

  const shared = await redisCheck(key, options, now);
  if (shared) return shared;

  warnDegradedOnce();
  return memoryCheck(key, options, now);
}

/**
 * Read a window without recording an attempt.
 *
 * `checkRateLimit` answers "may I, and I am taking one"; this answers "may I".
 * The difference is what lets a throttle charge only the attempts that failed,
 * while still refusing everything once the limit is reached — otherwise the
 * successful answers stay available and the limit can be read as an oracle.
 */
export async function peekRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();

  const shared = await redisPeek(key, options, now);
  if (shared) return shared;

  warnDegradedOnce();
  return memoryPeek(key, options, now);
}

/**
 * Redis counterpart to `memoryPeek`. Prunes expired members as it reads — the
 * same ZREMRANGEBYSCORE `redisCheck` does — so a peek never reports attempts
 * that have already fallen out of the window.
 */
async function redisPeek(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): Promise<RateLimitResult | null> {
  const rkey = `rl:${key}`;
  const replies = await upstashPipeline([
    ["ZREMRANGEBYSCORE", rkey, "0", String(now - windowMs)],
    ["ZCARD", rkey],
    ["ZRANGE", rkey, "0", "0", "WITHSCORES"],
  ]);
  if (!replies) return null;

  const count = Number(replies[1]);
  if (!Number.isFinite(count)) return null;
  // No ZADD here, so the current request is NOT counted: `< limit` where
  // `redisCheck` uses `<= limit` on a count that already includes itself.
  if (count < limit) return { ok: true, retryAfterMs: 0 };

  const oldest = replies[2];
  const oldestScore = Array.isArray(oldest) ? Number(oldest[1]) : NaN;
  const anchor = Number.isFinite(oldestScore) ? oldestScore : now;
  return { ok: false, retryAfterMs: Math.max(0, anchor + windowMs - now) };
}

function memoryPeek(
  key: string,
  { limit, windowMs }: RateLimitOptions,
  now: number
): RateLimitResult {
  const entry = store.get(key);
  if (!entry) return { ok: true, retryAfterMs: 0 };

  prune(entry, now, windowMs);
  if (entry.timestamps.length < limit) return { ok: true, retryAfterMs: 0 };

  const oldest = entry.timestamps[0] ?? now;
  return { ok: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
}

let warnedDegraded = false;

/**
 * Say once, in the server log, that the limiter is not actually limiting.
 *
 * The fallback is deliberately silent to callers — a limiter must never become
 * a point of failure — but silence toward *operators* is how a production
 * deployment ends up with no working rate limit and nobody aware of it. On
 * Vercel each invocation may be a fresh instance, so the per-instance window
 * lets a determined retry loop through almost unmetered, which is how a single
 * user can exhaust Supabase Auth's own per-IP budget for everyone else.
 */
function warnDegradedOnce(): void {
  if (warnedDegraded) return;
  warnedDegraded = true;
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/_TOKEN unset or unreachable — falling back to a per-instance window. On serverless this is not an effective limit; see docs/runbook.md."
  );
}
