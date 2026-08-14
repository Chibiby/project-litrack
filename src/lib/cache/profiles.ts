/**
 * Named Data Cache TTLs (spec R5, Tier B).
 *
 * This is LITRACK's ISR. Route-level ISR is unavailable — every role page is
 * force-dynamic because requireUser() reads cookies, and a Full Route Cache
 * entry is shared across users, so caching rendered HTML would leak one
 * school's data to another tenant. Instead the *data* is incrementally
 * revalidated: served from Next's Data Cache until its TTL lapses or a
 * mutation busts its tag, while the page itself still renders per-request
 * under the caller's own auth.
 *
 * Every TTL is bounded so that a mutation which forgets to bust a tag
 * self-heals within a known window rather than serving stale data forever.
 */

export type CacheProfile =
  /** Effectively immutable within a session (school name, enum-ish lookups). */
  | "static"
  /** Reference data changed by deliberate admin action (school lists, years). */
  | "reference"
  /** Rolled-up counts and charts — a minute of staleness is invisible. */
  | "aggregate"
  /** Anything a user expects to see change right after their own write. */
  | "volatile";

export const CACHE_TTL: Record<CacheProfile, number> = {
  static: 900,
  reference: 300,
  aggregate: 60,
  volatile: 15,
};

/** Explicit `revalidate` wins; otherwise the profile; otherwise `aggregate`. */
export function resolveRevalidate(opts: {
  profile?: CacheProfile;
  revalidate?: number;
}): number {
  if (typeof opts.revalidate === "number") return opts.revalidate;
  return CACHE_TTL[opts.profile ?? "aggregate"];
}
