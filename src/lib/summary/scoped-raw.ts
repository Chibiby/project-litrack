import type { ScopeSchool, SummaryFacetId } from "@/lib/summary/types";

/**
 * The tenancy fence of the Division Summary.
 *
 * Every facet's SQL runs over EVERY school (demo and inactive included) and
 * its rows are cached once for the whole division, keyed only by the period
 * the SQL received. Those raw rows hold other districts' and other schools'
 * figures, so they must never reach a shape function as they are: a shape
 * function also reads values out of the data (learner age columns, the latest
 * term with grades, the school-year picker, free-text designations), and an
 * unfiltered row would put another school's value on the page even where
 * `rollUp` drops its counts.
 *
 * INVARIANT: `scopeRaw` is the only producer of `ScopedRaw<T>`, and every shape
 * function takes `ScopedRaw<T>`, so the compiler refuses a shape call on rows
 * that did not pass through here. The `schools` argument must be the list
 * `resolveScopeSchools` returned for the caller's narrowed scope (filtered
 * further, never widened, e.g. to active schools for compliance).
 *
 * Rules:
 * - keep a row only when its `school_id` is one of `schools`' ids;
 * - drop a row with no `school_id` (fail closed), EXCEPT an attendance
 *   `holiday` row (`AttendanceDayMeta` is keyed by grade level, not school):
 *   keep it only when its `grade_level_id` belongs to a kept `roster` row,
 *   which is exactly the set the old per-scope SQL selected holidays for.
 */
declare const scopedRawBrand: unique symbol;

export type ScopedRaw<T> = readonly T[] & { readonly [scopedRawBrand]: true };

/** Every summary raw row says which school it belongs to (null only for an attendance holiday). */
export type ScopableRow = { school_id: string | null };

type AttendanceLikeRow = { kind: string; school_id: string | null; grade_level_id: string | null };

export function scopeRaw<T extends ScopableRow>(
  facetId: SummaryFacetId,
  raw: readonly T[],
  schools: readonly Pick<ScopeSchool, "id">[]
): ScopedRaw<T> {
  const keep = new Set(schools.map((s) => s.id));
  const inScope = (r: T) => r.school_id !== null && keep.has(r.school_id);

  let keptGrades: Set<string> | null = null;
  if (facetId === "attendance") {
    keptGrades = new Set();
    for (const r of raw as readonly (T & AttendanceLikeRow)[]) {
      if (r.kind === "roster" && r.grade_level_id && inScope(r)) keptGrades.add(r.grade_level_id);
    }
  }

  const kept = raw.filter((r) => {
    if (r.school_id !== null) return keep.has(r.school_id);
    if (!keptGrades) return false;
    const a = r as T & AttendanceLikeRow;
    return a.kind === "holiday" && a.grade_level_id !== null && keptGrades.has(a.grade_level_id);
  });
  return kept as unknown as ScopedRaw<T>;
}
