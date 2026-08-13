import "server-only";
import { isUpstashConfigured, upstashCommand } from "@/lib/cache/upstash";

/**
 * Shared Redis cache for state that must outlive a single deployment and be
 * consistent across instances — the two things `unstable_cache` cannot do.
 *
 * Use `cachedQuery` (@/lib/cache/unstable) for RSC data instead: it is
 * tag-invalidated and integrates with `revalidateTag`. Reach for this module
 * only when you need cross-instance coordination (rate limiting) or reads from
 * a context where the Next Data Cache is unavailable.
 *
 * Degrades to a direct fetcher call when UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN are absent, so local dev and preview deploys work
 * without credentials. A cache is an optimization: it must never be the reason
 * a request fails.
 */

/** Whether a shared store is available. Callers can pick a fallback path. */
export function isRedisConfigured(): boolean {
  return isUpstashConfigured();
}

/**
 * Read `key`, or run `fetcher` and store its result for `ttlSeconds`.
 *
 * Any Redis failure (unconfigured, network, malformed payload) falls through
 * to `fetcher`. Errors from `fetcher` itself propagate — those are real.
 */
export async function getCached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (!isUpstashConfigured()) return fetcher();

  const raw = await upstashCommand(["GET", key]);
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt or foreign-format entry: treat as a miss so the write below
      // replaces it, rather than handing back an unparsed string typed as T.
    }
  }

  const value = await fetcher();

  // `undefined` has no JSON form; storing it would read back as the *string*
  // "undefined" and silently poison the next hit.
  if (value !== undefined) {
    const ttl = Math.max(1, Math.floor(ttlSeconds));
    await upstashCommand(["SET", key, JSON.stringify(value), "EX", String(ttl)]);
  }

  return value;
}

/** Drop a single key. Safe to call when Redis is unconfigured. */
export async function invalidate(key: string): Promise<void> {
  if (!isUpstashConfigured()) return;
  await upstashCommand(["DEL", key]);
}

/**
 * Drop every key under `prefix` using SCAN.
 *
 * Deliberately not `KEYS` — that blocks the Redis event loop for the whole
 * scan on a shared instance. Bounded by MAX_ROUNDS so a large or churning
 * keyspace cannot spin here: a partial invalidation leaves entries that still
 * expire on their own TTL, which beats hanging the caller.
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  if (!isUpstashConfigured()) return;

  const MAX_ROUNDS = 50;
  let cursor = "0";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await upstashCommand([
      "SCAN",
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      "100",
    ]);
    if (!Array.isArray(reply)) return;

    const [next, keys] = reply as [unknown, unknown];
    if (Array.isArray(keys) && keys.length > 0) {
      await upstashCommand(["DEL", ...keys.map(String)]);
    }

    cursor = String(next ?? "0");
    if (cursor === "0") return;
  }
}
