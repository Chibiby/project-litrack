"use client";

import { useEffect, useState } from "react";

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

/**
 * Desktop sidebar expanded/collapsed state, persisted in localStorage.
 * Missing key → expanded (default).
 *
 * SSR / first paint always use expanded; after mount we sync from storage.
 * `hydrated` is false until that sync finishes so callers can skip width/ml
 * transitions and avoid an animated expand→collapse flash.
 *
 * Width / content-offset tokens: `@/lib/sidebar-layout`.
 */
export function useSidebarExpanded() {
  const [expanded, setExpandedState] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
      if (stored === "false") setExpandedState(false);
      else if (stored === "true") setExpandedState(true);
    } catch {
      // Private mode / blocked storage — keep default expanded.
    }
    const id = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  function setExpanded(value: boolean) {
    setExpandedState(value);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(value));
    } catch {
      // ignore
    }
  }

  function toggle() {
    setExpandedState((prev) => {
      const next = !prev;
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
