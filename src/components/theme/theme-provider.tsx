"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  resolveInitialTheme,
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

/**
 * Apply the theme to the DOM and persist it. Single source of truth for
 * "a theme became active" — keeps the class and storage from drifting apart.
 */
function applyTheme(next: Theme): void {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode / blocked storage — the class still applied.
  }
}

/**
 * Applies `.dark` on <html> and persists the choice.
 *
 * `ThemeScript` already set the class before first paint, so this effect is a
 * no-op on the happy path — it exists to reconcile React state with the DOM
 * the script produced, and to cover storage-blocked browsers.
 *
 * Mirrors the useSidebarExpanded pattern: SSR renders the default, mount syncs
 * from localStorage, `hydrated` gates transitions to avoid an animated flash.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode / blocked storage — keep the default.
    }
    const next = resolveInitialTheme(stored);
    setThemeState(next);
    // Apply the class directly (not via applyTheme) — this is a read from
    // storage, not a user choice, so it must not write storage back.
    document.documentElement.classList.toggle("dark", next === "dark");
    setHydrated(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

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
