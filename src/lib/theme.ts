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

/** Narrow an untrusted localStorage value to a Theme. */
export function resolveInitialTheme(stored: string | null): Theme {
  return stored === "dark" || stored === "light" ? stored : DEFAULT_THEME;
}
