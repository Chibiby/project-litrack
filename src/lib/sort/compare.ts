/**
 * Comparators for client-sorted tables — the half of the app that receives its
 * whole row set as a prop and sorts it in the browser rather than through a
 * Prisma `orderBy`. See `src/lib/sort/registry.ts` for the URL-param side that
 * both server- and client-sorted tables share.
 *
 * `compareNames` is the sole export, used by `compareTeacherRows` in
 * `src/components/admin/school-detail-view.tsx` — the one table in this repo
 * that is genuinely sorted client-side. It gives that table the same
 * `Intl.Collator` collation (case- and accent-insensitive) that Postgres'
 * `citext`/collation gives every server-sorted table, so "Ñuñez" and "Nunez"
 * group together here the same way they would in a query's `ORDER BY`.
 */

// Constructed once at module scope: creating a Collator per comparison is a
// real cost on a long list (it re-parses locale/sensitivity options every call).
const NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

/** Case- and accent-insensitive name/label comparator, e.g. "Ñ" ~ "N", "a" ~ "A". */
export function compareNames(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b);
}
