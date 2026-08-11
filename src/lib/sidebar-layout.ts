/**
 * Desktop sidebar width + matching content offset.
 *
 * MUST stay paired 1:1 — do not use a smaller content offset (underlap).
 * These must remain complete string literals in a Tailwind-scanned path
 * (`src/lib` / `src/components` / `src/hooks`). Do not build via concatenation.
 *
 * Use margin-left (not padding-left) so the content box starts after the rail
 * and cannot intercept sidebar pointer events.
 */
export const SIDEBAR_WIDTH_CLASS = {
  expanded: "w-64",
  collapsed: "w-[4.5rem]",
} as const;

export const CONTENT_OFFSET_CLASS = {
  expanded: "lg:ml-64",
  collapsed: "lg:ml-[4.5rem]",
} as const;
