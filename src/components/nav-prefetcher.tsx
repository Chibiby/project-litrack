"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Session-scoped warm set: each role shell prefetches its nav routes once.
 * Survives client navigations (module state); resets only on full page reload.
 */
const warmedShells = new Set<string>();

type NavPrefetcherProps = {
  /** Stable key for this shell (e.g. role + grade href fingerprint). */
  cacheKey: string;
  /** Routes to warm in the background after first paint. */
  hrefs: readonly string[];
};

/**
 * Background lazy-load of role nav destinations.
 * Runs once per cacheKey so layout entry does not re-prefetch on every page change.
 */
export function NavPrefetcher({ cacheKey, hrefs }: NavPrefetcherProps) {
  const router = useRouter();
  // Stable join for effect deps (parent may pass a new array each render).
  const hrefList = hrefs.join("\0");

  useEffect(() => {
    if (!hrefList || warmedShells.has(cacheKey)) return;

    const routes = hrefList.split("\0").filter(Boolean);
    let cancelled = false;

    const prefetchAll = () => {
      if (cancelled || warmedShells.has(cacheKey)) return;
      // Mark only after a successful run so React Strict Mode remounts can retry.
      warmedShells.add(cacheKey);
      for (const href of routes) {
        router.prefetch(href);
      }
    };

    // Let RoleShell paint first; then warm RSC payloads while idle.
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(prefetchAll, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(prefetchAll, 200);
    }

    return () => {
      cancelled = true;
      if (
        idleId !== undefined &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [cacheKey, hrefList, router]);

  return null;
}
