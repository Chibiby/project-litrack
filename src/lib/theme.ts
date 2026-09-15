/**
 * Theme constants and pure resolution logic.
 *
 * Deliberately DOM-free so it is unit-testable in the node vitest env and
 * importable from both server and client components.
 *
 * Light is the default even when the OS prefers dark (spec R9) — LITRACK is
 * used on shared school desktops whose OS theme is not the user's choice.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "litrack.theme";

export const DEFAULT_THEME: Theme = "light";

/**
 * Screens that always render light, whatever the stored theme: the two sign-in
 * pages are painted over a daytime illustration that a dark theme would fight.
 * The stored preference is left alone, so the app turns dark again after
 * sign-in. Mirrored inline in ThemeScript, which cannot import.
 */
export const ALWAYS_LIGHT_PATHS: readonly string[] = ["/login", "/admin/login"];

export function isAlwaysLightPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ALWAYS_LIGHT_PATHS.includes(trimmed);
}

/** Whether `.dark` belongs on <html> for this theme on this path. */
export function shouldApplyDark(theme: Theme, pathname: string | null | undefined): boolean {
  return theme === "dark" && !isAlwaysLightPath(pathname);
}

/** Narrow an untrusted localStorage value to a Theme. */
export function resolveInitialTheme(stored: string | null): Theme {
  return stored === "dark" || stored === "light" ? stored : DEFAULT_THEME;
}
