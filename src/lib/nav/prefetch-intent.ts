/**
 * Policy for hover/focus-intent prefetching (spec R6).
 *
 * DOM-free on purpose: `PrefetchLink` owns the event wiring, this owns the
 * decision. Kept separate because the failure mode here is expensive — every
 * FULL prefetch of a force-dynamic route re-runs middleware auth plus the
 * layout's Prisma queries, so an unbudgeted hover storm across a 200-row
 * roster can exhaust the pooler `connection_limit` and surface as error.tsx.
 * That is the same reasoning behind NavPrefetcher's concurrency cap.
 */

export const INTENT_DELAY_MS = 80;

/** Per-page-view prefetch budget. Roughly "the nav plus a screen of rows". */
export const MAX_INTENT_PREFETCHES = 12;

export type NetworkInfo = {
  saveData?: boolean;
  effectiveType?: string;
};

export type IntentTracker = {
  shouldPrefetch(href: string): boolean;
  markPrefetched(href: string): void;
  reset(): void;
  size(): number;
};

/** Only same-origin app paths are worth an RSC prefetch. */
function isNavigational(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function createIntentTracker(): IntentTracker {
  const seen = new Set<string>();

  return {
    shouldPrefetch(href) {
      if (!isNavigational(href)) return false;
      if (seen.has(href)) return false;
      if (seen.size >= MAX_INTENT_PREFETCHES) return false;
      return true;
    },
    markPrefetched(href) {
      seen.add(href);
    },
    reset() {
      seen.clear();
    },
    size() {
      return seen.size;
    },
  };
}

/** Respect Data Saver and slow links — speculative fetches cost real money. */
export function isSaveDataConnection(conn: NetworkInfo | undefined): boolean {
  if (!conn) return false;
  if (conn.saveData === true) return true;
  return conn.effectiveType === "2g" || conn.effectiveType === "slow-2g";
}
