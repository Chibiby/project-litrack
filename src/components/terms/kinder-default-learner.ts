/**
 * Which learner the Kindergarten checklist opens on.
 *
 * Pure, so the choice can be unit-tested without a database.
 * `terms-reports/kinder/page.tsx` still resolves the id it picks here through
 * `loadKinderChecklist`'s advisory-scoped `learnerWhere` — that `findFirst` is
 * the actual tenancy boundary, not this function. This only decides which id
 * to ask it for: the requested `?learner=` id when it belongs to the roster,
 * otherwise the roster's first learner (already ordered by `fullName`), or
 * `null` for an empty roster.
 */
export function resolveDefaultKinderLearnerId<T extends { id: string }>(
  roster: readonly T[],
  requestedLearnerId: string | null | undefined
): string | null {
  if (requestedLearnerId && roster.some((r) => r.id === requestedLearnerId)) {
    return requestedLearnerId;
  }
  return roster[0]?.id ?? null;
}

/**
 * The open learner's 1-based position in the roster ("N of M"), or `null`
 * when there is no open learner or it is not in this roster.
 */
export function kinderLearnerPosition<T extends { id: string }>(
  roster: readonly T[],
  learnerId: string | null
): number | null {
  if (!learnerId) return null;
  const index = roster.findIndex((r) => r.id === learnerId);
  return index === -1 ? null : index + 1;
}
