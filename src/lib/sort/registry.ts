/**
 * Shared "Sort by" primitive for every data table, server- or client-paginated.
 * Pure, no Prisma runtime import, no "server-only" — safe to import from a
 * client component (dropdowns render there) as well as from a server page or
 * action that builds a Prisma `orderBy`.
 *
 * Generalises the pattern in `src/lib/learners/pagination.ts` (`LearnerListSort`,
 * `SORTS`, `parseLearnerListParams`): an allow-listed kebab-case value that
 * appears in the URL, validated case-insensitively with a fixed fallback.
 */

export type SortOption<K extends string> = {
  /** Kebab-case value that appears in the URL, e.g. `?sort=name`. */
  value: K;
  /** Label shown in the dropdown. */
  label: string;
};

export type SortDefinition<K extends string> = {
  options: readonly SortOption<K>[];
  fallback: K;
  /**
   * Parse `?sort=` (or any raw searchParams entry) into an allow-listed value.
   *
   * - Case-insensitive: `"NAME"` and `"name"` both match `"name"`.
   * - Unknown value, `undefined`, or `""` all fall back to `fallback`.
   * - Next.js searchParams can hand back `string[]` when a key repeats in the
   *   URL (e.g. `?sort=a&sort=b`). There is no ordering guarantee a caller can
   *   rely on for "the" sort in that case, and a table only ever needs one
   *   value, so the first entry is used and anything else in the array is
   *   ignored; an empty array falls back like `undefined`.
   * - Never throws.
   */
  parse(raw: string | string[] | undefined): K;
};

/**
 * Define an allow-listed sort. Mirrors `parseLearnerListParams`'s validation
 * behaviour (lowercase, allow-list membership, fixed fallback) but is generic
 * over the option union so every table can share one implementation.
 */
export function defineSort<K extends string>(
  options: readonly SortOption<K>[],
  fallback: K
): SortDefinition<K> {
  const values: readonly K[] = options.map((o) => o.value);

  function parse(raw: string | string[] | undefined): K {
    const single = Array.isArray(raw) ? raw[0] : raw;
    const lower = (single ?? "").trim().toLowerCase();
    return (values as readonly string[]).includes(lower) ? (lower as K) : fallback;
  }

  return { options, fallback, parse };
}

/**
 * Exhaustiveness check between a sort's option list and the `orderBy` mapper a
 * caller writes for it. Call it once, at module scope, right next to the
 * mapper:
 *
 * ```ts
 * const LEARNER_SORT = defineSort(
 *   [
 *     { value: "name", label: "Name" },
 *     { value: "age", label: "Age" },
 *   ] as const,
 *   "name"
 * );
 *
 * const LEARNER_ORDER_BY = {
 *   name: { fullName: "asc" },
 *   age: { birthDate: "desc" },
 * } satisfies Record<(typeof LEARNER_SORT.options)[number]["value"], Prisma.LearnerOrderByWithRelationInput>;
 *
 * assertOrderByCoversOptions(LEARNER_SORT, LEARNER_ORDER_BY);
 * ```
 *
 * `satisfies Record<Option, ...>` already forces TypeScript to reject a
 * mapper missing an option or typo'd against `Prisma.*OrderByWithRelationInput`
 * at the call site above — this function exists so the *pairing itself* has a
 * single, greppable assertion a reviewer can find, and so a mapper written as
 * a plain object literal (no `satisfies`) still fails at runtime in tests
 * rather than silently sorting nothing for a forgotten option.
 */
export function assertOrderByCoversOptions<K extends string>(
  sort: SortDefinition<K>,
  orderBy: Record<K, unknown>
): void {
  for (const option of sort.options) {
    if (!(option.value in orderBy)) {
      throw new Error(
        `Sort option "${option.value}" has no matching orderBy clause. ` +
          `Add one before wiring this option onto a table.`
      );
    }
  }
}
