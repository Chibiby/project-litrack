/**
 * Shared shape for the header search.
 *
 * Deliberately separate from `@/lib/actions/global-search`, which is a
 * `"use server"` module: importing a constant or a type from there drags the
 * whole server graph — Prisma included — into anything that touches it. Next
 * rewrites such an import to an RPC reference at build time, so production never
 * notices, but a component test renders the real module and dies loading it.
 *
 * Keep values that both sides need here, and import the action itself only where
 * it is actually called.
 */

/** Below this, the header search queries nothing and shows nothing. */
export const GLOBAL_SEARCH_MIN_CHARS = 2;

/** What a row is, used for its group heading and icon. */
export type GlobalSearchKind = "learner" | "teacher" | "section" | "school";

export type GlobalSearchHit = {
  id: string;
  kind: GlobalSearchKind;
  title: string;
  /** Grade, section, division — whatever disambiguates two same-named rows. */
  subtitle: string | null;
  href: string;
};
