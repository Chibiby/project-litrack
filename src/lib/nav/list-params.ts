/**
 * Navigation-policy decisions for paginated list pages.
 *
 * Pure and DOM-free, same posture as prefetch-intent.ts and warm-hrefs.ts —
 * this file only answers the question, callers own the React/Next wiring.
 */

/**
 * The shape a Next server component receives as `searchParams`, after
 * `await`ing the Next 15+ promise. `listKey` also accepts a `URLSearchParams`
 * (client-side `useSearchParams()` callers) so both server and client list
 * pages can share one function without a manual conversion step.
 */
export type ListSearchParams =
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | URLSearchParams;

/** Normalizes a single param value to a comparable string. */
function normalizeValue(value: string | readonly string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) {
    // Sort so a param that arrives as string[] (Next can hand back
    // `?facet=a&facet=b` this way) produces the same key regardless of the
    // order duplicate query params appeared in the URL.
    return [...value].sort().join(",");
  }
  return value as string;
}

function readParam(
  params: ListSearchParams,
  key: string
): string | readonly string[] | undefined {
  if (params instanceof URLSearchParams) {
    const all = params.getAll(key);
    if (all.length === 0) return undefined;
    return all.length === 1 ? all[0] : all;
  }
  return params[key];
}

/**
 * Stable key over ONLY the list-affecting params in `keys`, for use as a
 * React `<Suspense key>` around a list's rows. Changing the key re-suspends
 * the boundary; an unrelated param (e.g. an admin's `?schoolId=` view
 * context, a modal flag) must never appear in `keys`, so it never forces a
 * re-suspend.
 *
 * Stability guarantees:
 * - Param order in the URL does not affect the key (`keys` order is fixed
 *   by the caller and iterated in that order, not the URL's order).
 * - An absent param and an empty-string param produce the same key (both
 *   normalize to `""`).
 * - A `string[]`-valued param (Next can hand back duplicate query keys this
 *   way) is sorted before joining, so param order does not matter there
 *   either.
 */
export function listKey(params: ListSearchParams, keys: readonly string[]): string {
  return keys.map((key) => `${key}=${normalizeValue(readParam(params, key))}`).join("&");
}

/**
 * Prefetch allowlist for a numbered pager: at most the immediate neighbours
 * of `page`, clamped to `[1, totalPages]`. This is a COST GUARD, not a UX
 * nicety — every prefetch of a `force-dynamic` list route re-runs middleware
 * auth plus the layout's Prisma work, and `resolvePooledDatabaseUrl` floors
 * `connection_limit` at 3, so prefetching a whole numbered pager would fire
 * many authenticated round trips at once. Returning at most two entries is
 * the point of this function; do not widen it to "prefetch all pages".
 *
 * Edge cases (decided, not thrown):
 * - Single-page list (`totalPages <= 1`): returns `[]` — there is no
 *   neighbour to prefetch.
 * - `page` on the first page: returns just `[page + 1]`.
 * - `page` on the last page: returns just `[page - 1]`.
 * - Nonsensical input (`page` or `totalPages` <= 0, non-integer, or
 *   `page > totalPages`): clamped into range rather than thrown; a `page`
 *   outside `[1, totalPages]` is treated as if it were the nearest valid
 *   edge, so the result still never includes a page outside
 *   `[1, totalPages]` and never includes `page` itself.
 */
export function adjacentPages(page: number, totalPages: number): number[] {
  const maxPage = Math.floor(totalPages);
  if (!Number.isFinite(maxPage) || maxPage <= 1) return [];

  const current = Math.floor(page);
  if (!Number.isFinite(current)) return [];
  const clampedCurrent = Math.min(Math.max(current, 1), maxPage);

  const result: number[] = [];
  const prev = clampedCurrent - 1;
  const next = clampedCurrent + 1;
  if (prev >= 1 && prev !== clampedCurrent) result.push(prev);
  if (next <= maxPage && next !== clampedCurrent) result.push(next);
  return result;
}
