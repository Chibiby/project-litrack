"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export const SIDEBAR_EXPANDED_KEY = "litrack.sidebar.expanded";

/**
 * Reset desktop sidebar preference to expanded.
 * Call on successful login so a new session always starts expanded;
 * within the session, toggle still persists via localStorage across refresh.
 */
export function resetSidebarExpandedPreference() {
  try {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, "true");
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

/** The stored flag never changes from outside this hook; nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function getServerExpanded(): boolean {
  return true;
}

function getStoredExpanded(): boolean {
  try {
    if (localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "false") return false;
  } catch {
    // Private mode / blocked storage — keep default expanded.
  }
  return true;
}

/**
 * Desktop sidebar expanded/collapsed state, persisted in localStorage.
 * Missing key → expanded (default).
 *
 * SSR / first paint always use expanded; `useSyncExternalStore` swaps in the
 * stored value right after mount, so there is nothing for the server and the
 * client to disagree on at hydration time.
 * `hydrated` is false until a tick after that sync so callers can skip
 * width/ml transitions and avoid an animated expand→collapse flash.
 *
 * Width / content-offset tokens: `@/lib/sidebar-layout`.
 */
export function useSidebarExpanded() {
  const storedExpanded = useSyncExternalStore(subscribeNever, getStoredExpanded, getServerExpanded);
  const [override, setOverride] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const expanded = override ?? storedExpanded;

  useEffect(() => {
    const id = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  function setExpanded(value: boolean) {
    setOverride(value);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(value));
    } catch {
      // ignore
    }
  }

  function toggle() {
    setOverride((prev) => {
      const next = !(prev ?? storedExpanded);
      try {
        localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { expanded, setExpanded, toggle, hydrated };
}
