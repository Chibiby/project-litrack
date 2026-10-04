import "server-only";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSummary } from "@/lib/cache/tags";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { SUMMARY_CACHE_VERSION, SUMMARY_FACETS } from "@/lib/summary/facets";
import { SUMMARY_FACET_IDS, type SummaryFacetId } from "@/lib/summary/types";

/**
 * The Division Summary warm. Every facet's only cache entry is its
 * division-wide raw rows (no scope, no demo flag, no level in the key), and
 * every scope and level is shaped from those rows per request. So warming one
 * raw entry per facet, for the period a page with no period in its URL shows,
 * warms the default view of every scope and level: 8 SQL runs, nothing more.
 */

export type WarmResult = {
  facetId: SummaryFacetId;
  ok: boolean;
  ms: number;
  error?: string;
};

/** The stored warm outcome lives a day; past it Next refreshes it once in the background. */
export const WARM_TTL_SECONDS = 86400;

/**
 * Refresh each facet's default raw entry, strictly one after another (the
 * database is contended). A failure is logged and recorded, never allowed to
 * stop the rest. Read-only: no audit, no writes.
 */
export async function warmDivisionRaw(): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  for (const facetId of SUMMARY_FACET_IDS) {
    const started = Date.now();
    try {
      await SUMMARY_FACETS[facetId].warmRaw();
      results.push({ facetId, ok: true, ms: Date.now() - started });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(`[cron/summary-warm] ${facetId} failed:`, error);
      results.push({ facetId, ok: false, ms: Date.now() - started, error });
    }
  }
  return results;
}

export type WarmOutcome = {
  /** Epoch ms when this warm ran (a hit returns the stored, earlier value). */
  at: number;
  failures: { facetId: SummaryFacetId; error?: string }[];
  /** Compact per-facet record, in run order. */
  results: { facetId: SummaryFacetId; ok: boolean; ms: number }[];
};

/**
 * The cached function IS the warm. Top-level and never redefined: unstable_cache
 * keys on `${fn.toString()}-${keyParts}`, so the key must not depend on a
 * closure created per call.
 *
 * The raw reads inside run as NESTED unstable_cache calls (this callback runs
 * in an `unstable-cache` work-unit store). Next bypasses the cache READ for
 * nested calls (unstable-cache.js: `isNestedUnstableCache`), so each facet's
 * SQL really runs, once, and its rows are still WRITTEN (`cacheNewResult` is
 * queued on `pendingRevalidates`). That is what a warm wants: it recomputes
 * and stores.
 */
async function runWarm(): Promise<WarmOutcome> {
  const results = await warmDivisionRaw();
  return {
    at: Date.now(),
    failures: results.filter((r) => !r.ok).map(({ facetId, error }) => ({ facetId, error })),
    results: results.map(({ facetId, ok, ms }) => ({ facetId, ok, ms })),
  };
}

/**
 * The cron entry point (every 5 minutes). One cachedQuery whose function is
 * the warm, so it runs only when unstable_cache would run it:
 *
 * - Miss: the first tick after a deploy (OpenNext puts the build id in every
 *   KV key) or after a `divisionSummary` bust whose tag is expired. Runs the
 *   warm in the foreground and stores the outcome.
 * - Hit: every later tick. One KV read, no raw loads, no database query.
 * - Stale: older than a day, or a `divisionSummary` tag marked stale. Returns
 *   the stored outcome and refreshes it ONCE in the background
 *   (`pendingRevalidates` dedupes per key). So the warm runs at most once a
 *   day without a deploy or bust, which keeps it inside the free tier.
 *
 * A warm with failures is stored too: the route answers 502 for it until the
 * next daily refresh or bust, rather than re-warming every tick.
 */
export function warmOnce(): Promise<WarmOutcome> {
  // The default compliance and attendance raw keys carry today's date, so they
  // change at Manila midnight. The date key here makes the first tick of each
  // Manila day miss and warm the new day's keys once; later ticks that day hit.
  const todayKey = formatLocalDateKey(schoolToday());
  return cachedQuery(runWarm, {
    keyParts: ["summary-warm", SUMMARY_CACHE_VERSION, todayKey],
    tags: [divisionSummary],
    revalidate: WARM_TTL_SECONDS,
  });
}
