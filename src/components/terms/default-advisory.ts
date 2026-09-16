/**
 * The End of Terms sheet's default advisory scope for a teacher whose
 * advisories mix Kindergarten with other grades, when the URL carries no
 * `?advisory=` (or one that does not resolve to a placement).
 *
 * Owner decision: such a teacher never gets "All advisories" — the numeric
 * sheet must always resolve to exactly one section. `resolveAdvisoryTarget`
 * (`src/lib/teachers/advisory.ts`) correctly *asks* rather than guesses when
 * there is more than one non-Kinder advisory — that's right for an action
 * that saves into a section. A *default* is different: the owner asked for a
 * guess, specifically the first non-Kinder advisory.
 *
 * `numericPlacements` must already be filtered and ordered the way the hero
 * dropdown renders its options (`splitByKinderGradeType` run over the full
 * placement list preserves that order), so the section this returns is
 * always the same one the dropdown shows selected — the rendered selection
 * and the rendered sheet can never disagree. This does not derive "the
 * teacher's grade" from anything; it only reads the head of the list it is
 * handed, and each placement keeps its own grade.
 */
export function resolveMixedAdvisoryDefault<T>(numericPlacements: readonly T[]): T | null {
  return numericPlacements[0] ?? null;
}
