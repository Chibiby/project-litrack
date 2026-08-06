/**
 * In-memory sliding-window rate limiter.
 *
 * Serverless caveat: each instance has its own memory. Limits are per-instance,
 * not global — a burst across cold starts / replicas can exceed the intended
 * ceiling. Fine for soft abuse protection on login/invite; not a hard guarantee.
 *
 * TODO: Add an Upstash Redis adapter (e.g. @upstash/ratelimit) for production
 * multi-instance deployments when a shared store is available.
 */

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
 * Record an attempt against `key`. Returns whether the attempt is allowed.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  prune(entry, now, options.windowMs);

  if (entry.timestamps.length >= options.limit) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterMs = Math.max(0, oldest + options.windowMs - now);
    return { ok: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { ok: true, retryAfterMs: 0 };
}
