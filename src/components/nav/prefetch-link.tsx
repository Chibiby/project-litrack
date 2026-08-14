"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import {
  INTENT_DELAY_MS,
  createIntentTracker,
  isSaveDataConnection,
  type NetworkInfo,
} from "@/lib/nav/prefetch-intent";

/**
 * `next/link` plus hover / focus / touch intent prefetch (spec R6).
 *
 * Layering: NavPrefetcher warms a small set of shell routes on idle;
 * this warms whatever the user is actually pointing at, a few hundred
 * milliseconds before the click. Between them the Client Router Cache
 * (staleTimes.static = 600s in next.config.mjs) usually has the Flight
 * payload ready, so the destination swaps without a loading.tsx flash —
 * which is what makes the skeleton reduction in Task 10 safe.
 *
 * The tracker is module-level, not per-instance, so 200 roster rows share
 * one budget rather than each claiming their own.
 */

const tracker = createIntentTracker();

/** Next App Router PrefetchKind.FULL — full Flight data for dynamic routes. */
const PREFETCH_FULL = { kind: "full" } as NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;

/** Clear the per-page-view prefetch budget (used by tests and, via PrefetchLink, on route change). */
export function resetIntentBudget(): void {
  tracker.reset();
}

/**
 * Pathname the budget was last reset for. Module-level because the tracker
 * itself is module-level and shared by every PrefetchLink instance — a
 * roster with 200 links must agree on "have we already reset for this
 * navigation" rather than each instance resetting independently.
 */
let lastResetPathname: string | null = null;

function connectionInfo(): NetworkInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInfo }).connection;
}

export type PrefetchLinkProps = React.ComponentProps<typeof Link> & {
  href: string;
  /** Set false for links that should keep default Link behaviour only. */
  intent?: boolean;
};

export function PrefetchLink({
  href,
  intent = true,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onTouchStart,
  children,
  ...rest
}: PrefetchLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Reset once per pathname change, not once per instance: many
    // PrefetchLink instances mount/re-render on the same navigation, but
    // the budget must only clear the first time so links that already
    // recorded a prefetch for the new page aren't undone by a later one.
    if (lastResetPathname === pathname) return;
    lastResetPathname = pathname;
    resetIntentBudget();
  }, [pathname]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const runPrefetch = useCallback(() => {
    if (!tracker.shouldPrefetch(href)) return;
    if (isSaveDataConnection(connectionInfo())) return;
    tracker.markPrefetched(href);
    try {
      router.prefetch(href, PREFETCH_FULL);
    } catch {
      // Prefetch is best-effort; never surface into the UI.
    }
  }, [href, router]);

  const schedulePrefetch = useCallback(() => {
    if (!intent) return;
    if (!tracker.shouldPrefetch(href)) return;
    clearTimer();
    // Delay filters cursors merely passing over on the way somewhere else.
    timerRef.current = setTimeout(runPrefetch, INTENT_DELAY_MS);
  }, [intent, href, clearTimer, runPrefetch]);

  return (
    <Link
      href={href}
      onMouseEnter={(e) => {
        schedulePrefetch();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        clearTimer();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        schedulePrefetch();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        // No hover on touch — the tap is already committed, so go now.
        if (intent) runPrefetch();
        onTouchStart?.(e);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
