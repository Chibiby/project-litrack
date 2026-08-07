"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Last successful full-prefetch time per cacheKey.
 * Survives client navigations (module state); resets on full page reload.
 *
 * Must not be a forever Set: Client Router Cache expires (staleTimes) and
 * mutations (revalidatePath / router.refresh) wipe prefetch entries. If we
 * never re-warm, sidebar routes feel fast once then cold-reload later.
 */
const warmedAt = new Map<string, number>();

/**
 * Re-warm slightly before `experimental.staleTimes.static` (600s in next.config)
 * so idle prefetch replenishes Flight data before navigations go cold.
 */
const WARM_TTL_MS = 480_000;

const INVALIDATE_EVENT = "litrack:nav-warm-invalidate";

/** Next App Router PrefetchKind.FULL — full Flight data for dynamic routes. */
const PREFETCH_FULL = { kind: "full" } as NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;

type NavPrefetcherProps = {
  /** Stable key for this warm batch (e.g. role + href fingerprint). */
  cacheKey: string;
  /** Routes to warm in the background after first paint. */
  hrefs: readonly string[];
};

function isWarmFresh(cacheKey: string): boolean {
  const at = warmedAt.get(cacheKey);
  if (at === undefined) return false;
  return Date.now() - at < WARM_TTL_MS;
}

/**
 * Clear warm timestamps so mounted NavPrefetchers re-run idle prefetch.
 * Call after mutations that `revalidatePath` / `router.refresh` and wipe the
 * Client Prefetch Cache.
 */
export function invalidateNavWarm(cacheKey?: string): void {
  if (cacheKey) {
    warmedAt.delete(cacheKey);
  } else {
    warmedAt.clear();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(INVALIDATE_EVENT, { detail: { cacheKey } })
    );
  }
}

/**
 * Background lazy-load of nav destinations.
 * Warms once per cacheKey, then again when the TTL elapses, the tab becomes
 * visible after expiry, or `invalidateNavWarm` runs after a cache-busting write.
 *
 * Uses PrefetchKind `full` so force-dynamic + loading.tsx routes warm the full
 * RSC payload (not only the loading skeleton).
 */
export function NavPrefetcher({ cacheKey, hrefs }: NavPrefetcherProps) {
  const router = useRouter();
  // Stable join for effect deps (parent may pass a new array each render).
  const hrefList = hrefs.join("\0");

  useEffect(() => {
    if (!hrefList) return;

    const routes = hrefList.split("\0").filter(Boolean);
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const prefetchAll = () => {
      if (cancelled || isWarmFresh(cacheKey)) return;
      warmedAt.set(cacheKey, Date.now());
      for (const href of routes) {
        router.prefetch(href, PREFETCH_FULL);
      }
    };

    const scheduleWarm = () => {
      if (cancelled || isWarmFresh(cacheKey)) return;

      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(prefetchAll, { timeout: 1500 });
      } else {
        timeoutId = setTimeout(prefetchAll, 200);
      }
    };

    const clearScheduled = () => {
      if (
        idleId !== undefined &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
        idleId = undefined;
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    // Initial warm after RoleShell / parent paint.
    scheduleWarm();

    // RoleShell stays mounted — interval replenishes before staleTimes.static.
    const intervalId = window.setInterval(scheduleWarm, WARM_TTL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleWarm();
    };
    document.addEventListener("visibilitychange", onVisible);

    const onInvalidate = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string }>).detail;
      if (detail?.cacheKey && detail.cacheKey !== cacheKey) return;
      clearScheduled();
      scheduleWarm();
    };
    window.addEventListener(INVALIDATE_EVENT, onInvalidate);

    return () => {
      cancelled = true;
      clearScheduled();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(INVALIDATE_EVENT, onInvalidate);
    };
  }, [cacheKey, hrefList, router]);

  return null;
}
