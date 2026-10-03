/**
 * URL helpers shared by the summary controls. Pure and client-safe: the scope
 * bar, the param controls and the facet switcher all build their hrefs here so
 * a change to one control never drops the others' params.
 */

export type FlatSearchParams = Record<string, string | undefined>;

/** Next hands repeated keys over as arrays; the summary only reads the first. */
export function flattenSearchParams(
  search: Record<string, string | string[] | undefined>
): FlatSearchParams {
  const flat: FlatSearchParams = {};
  for (const [key, value] of Object.entries(search)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}

/** The params that pick the scope, kept when moving between facets. */
export const SUMMARY_SCOPE_KEYS = ["level", "district", "schoolId"] as const;

/**
 * `basePath` with `current` merged with `patch`. A null or empty patch value
 * removes the key, so defaults (`level=overall`, "all districts") never
 * clutter the URL.
 */
export function summaryHref(
  basePath: string,
  current: FlatSearchParams,
  patch: Record<string, string | null | undefined> = {},
  keep?: readonly string[]
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (keep && !keep.includes(key)) continue;
    if (key in patch) continue;
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

const TABLE_PARAM = /^(sort|dir|page)\./;
const PAGE_PARAM = /^page\./;

function omitKeys(current: FlatSearchParams, drop: (key: string) => boolean): FlatSearchParams {
  const next: FlatSearchParams = {};
  for (const [key, value] of Object.entries(current)) {
    if (!drop(key)) next[key] = value;
  }
  return next;
}

/**
 * `current` without any per-table `sort.<k>`, `dir.<k>` or `page.<k>` param.
 * Those keys are dynamic (one set per section), so a scope change cannot name
 * them in a patch.
 */
export function withoutTableParams(current: FlatSearchParams): FlatSearchParams {
  return omitKeys(current, (key) => TABLE_PARAM.test(key));
}

/** `current` without any `page.<k>`: a new search shrinks every table. */
export function withoutPageParams(current: FlatSearchParams): FlatSearchParams {
  return omitKeys(current, (key) => PAGE_PARAM.test(key));
}

/** The params that change what the period bar shows; search, sort and paging do not. */
export function withoutListParams(current: FlatSearchParams): FlatSearchParams {
  return omitKeys(current, (key) => key === "q" || TABLE_PARAM.test(key));
}

/** Anchor id for a section; facet section ids carry `:` and `.`. */
export function sectionAnchorId(sectionId: string): string {
  return `summary-${sectionId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
