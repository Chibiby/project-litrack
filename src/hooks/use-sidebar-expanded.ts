"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export const SIDEBAR_EXPANDED_KEY = "litrack.sidebar.expanded";

/**
 * Tablet landscape: the sidebar renders as a fixed rail from `lg` (1024px),
 * but a full 16rem expanded rail crowds the content pane before the desktop
 * breakpoint (1280px) gives it room to breathe. Only used as the *default* —
 * an explicit toggle or a persisted preference always wins over it.
 */
const TABLET_LANDSCAPE_QUERY = "(min-width: 1024px) and (max-width: 1279px)";

/**
 * Clear any persisted desktop sidebar preference.
 * Call on successful login so a new session starts from the width-based
 * default (expanded on desktop, folded in the tablet-landscape band) instead
 * of inheriting a previous session's stored value; within the session,
 * toggle still persists via localStorage across refresh.
 */
export function resetSidebarExpandedPreference() {
  try {
    localStorage.removeItem(SIDEBAR_EXPANDED_KEY);
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

/** `null` means no explicit preference is stored — the caller falls back to a width-based default. */
function getStoredExpanded(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {
    // Private mode / blocked storage — keep default.
  }
  return null;
}

/** `matchMedia` is the external system here, read through `useSyncExternalStore`
 * rather than mirrored into local state, so there is no synchronous `setState`
 * in an effect body for `react-hooks/set-state-in-effect` to flag. */
function subscribeTabletLandscape(callback: () => void): () => void {
  const mql = window.matchMedia(TABLET_LANDSCAPE_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getTabletLandscape(): boolean {
  return window.matchMedia(TABLET_LANDSCAPE_QUERY).matches;
}

function getServerTabletLandscape(): boolean {
  return false;
}

/**
 * Desktop sidebar expanded/collapsed state, persisted in localStorage.
 * Missing key → expanded on desktop widths, collapsed in the 1024–1279px
 * tablet-landscape band (see `TABLET_LANDSCAPE_QUERY`).
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
  const stored = useSyncExternalStore(subscribeNever, getStoredExpanded, getServerExpanded);
  const tabletLandscape = useSyncExternalStore(
    subscribeTabletLandscape,
    getTabletLandscape,
    getServerTabletLandscape
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const widthDefault = !tabletLandscape;
  const expanded = override ?? stored ?? widthDefault;

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
      const next = !(prev ?? stored ?? widthDefault);
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
