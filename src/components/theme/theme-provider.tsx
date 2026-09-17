"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  shouldApplyDark,
  type Theme,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** False until the stored preference has been read; use to defer transitions. */
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeSnapshot = { theme: Theme; hydrated: boolean };

const SERVER_THEME_SNAPSHOT: ThemeSnapshot = { theme: DEFAULT_THEME, hydrated: false };

/**
 * Module store backing the read side of `theme`. `themeSnapshotStale` starts
 * true so the very first read goes to storage; it is set true again once the
 * last subscriber unmounts, so a fresh mount (a real remount, or — in
 * tests — a fresh `render()`) reads fresh rather than inheriting whatever an
 * earlier mount cached. A mounted provider never re-polls beyond that, same
 * as the old effect's `[]` dependency array.
 */
let themeSnapshot: ThemeSnapshot = SERVER_THEME_SNAPSHOT;
let themeSnapshotStale = true;
const themeListeners = new Set<() => void>();

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      themeSnapshotStale = true;
    }
  };
}

function getThemeSnapshot(): ThemeSnapshot {
  if (themeSnapshotStale) {
    themeSnapshotStale = false;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — keep the default.
    }
    themeSnapshot = { theme: resolveInitialTheme(stored), hydrated: true };
  }
  return themeSnapshot;
}

function getServerThemeSnapshot(): ThemeSnapshot {
  return SERVER_THEME_SNAPSHOT;
}

/**
 * Apply the theme to the DOM and persist it. Single source of truth for
 * "a theme became active" — keeps the class and storage from drifting apart.
 */
function applyTheme(next: Theme): void {
  document.documentElement.classList.toggle(
    "dark",
    shouldApplyDark(next, window.location.pathname)
  );
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode / blocked storage — the class still applied.
  }
}

/**
 * Applies `.dark` on <html> and persists the choice.
 *
 * `ThemeScript` already set the class before first paint, so the reconciling
 * effect below is a no-op on the happy path — it exists to reconcile React
 * state with the DOM the script produced, and to cover storage-blocked
 * browsers.
 *
 * SSR renders the default; `useSyncExternalStore` swaps in the stored value
 * right after mount (before paint, same timing a layout effect would give),
 * mirrors the useSidebarExpanded pattern — so there is nothing for the server
 * and the client to disagree on at hydration time.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme: storedTheme, hydrated } = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );
  const [override, setOverride] = useState<Theme | null>(null);
  const theme = override ?? storedTheme;
  const pathname = usePathname();

  // Client navigation into or out of an always-light screen (signing in,
  // signing out) re-derives the class; the stored choice is untouched.
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.classList.toggle(
      "dark",
      shouldApplyDark(theme, pathname ?? window.location.pathname)
    );
  }, [hydrated, theme, pathname]);

  const setTheme = useCallback((next: Theme) => {
    setOverride(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setOverride(next);
    applyTheme(next);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, hydrated }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
