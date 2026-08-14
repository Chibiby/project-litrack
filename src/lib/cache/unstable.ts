import "server-only";
import { unstable_cache } from "next/cache";
import { resolveRevalidate, type CacheProfile } from "@/lib/cache/profiles";

export type CachedOptions = {
  /**
   * Cache key segments (must be serializable / stable).
   *
   * Tenant safety: any school-scoped query MUST include its `schoolId` (or
   * `userId`) here. Two tenants sharing a key part is a cross-tenant leak.
   */
  keyParts: string[];
  /** Tags for `revalidateTag` invalidation. */
  tags: string[];
  /** Named TTL profile — see `@/lib/cache/profiles`. Defaults to "aggregate". */
  profile?: CacheProfile;
  /** Explicit TTL override in seconds. Wins over `profile`. */
  revalidate?: number;
};

/**
 * Cross-request Data Cache wrapper around Next `unstable_cache`.
 * Works on `force-dynamic` pages (auth) — bypasses Full Route Cache limits.
 */
export function cachedQuery<T>(
  fn: () => Promise<T>,
  options: CachedOptions
): Promise<T> {
  const { keyParts, tags, profile, revalidate } = options;
  return unstable_cache(fn, keyParts, {
    tags,
    revalidate: resolveRevalidate({ profile, revalidate }),
  })();
}
