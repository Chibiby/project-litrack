import "server-only";
import { unstable_cache } from "next/cache";

export type CachedOptions = {
  /** Cache key segments (must be serializable / stable). */
  keyParts: string[];
  /** Tags for `revalidateTag` invalidation. */
  tags: string[];
  /**
   * TTL in seconds. Short defaults keep dashboards fresh even if a
   * mutation forgets a tag; tags still give instant invalidation on writes.
   */
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
  const { keyParts, tags, revalidate = 60 } = options;
  return unstable_cache(fn, keyParts, { tags, revalidate })();
}
