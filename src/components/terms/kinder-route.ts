/**
 * The Kindergarten End-of-Term checklist route's URL, shared by the numeric
 * End of Terms page (redirecting a Kinder-only or Kinder-picked teacher away),
 * the checklist page itself (rebuilding its own URL on advisory/learner
 * change) and the hero's advisory control.
 *
 * Kept out of `src/lib/terms/kinder-*.ts` on purpose — that module family is
 * pure domain logic owned elsewhere; this is presentation-layer routing.
 */
export const KINDER_TERMS_REPORTS_PATH = "/teacher/terms-reports/kinder";

export type KinderChecklistUrlState = {
  schoolId?: string | null;
  advisory?: string | null;
  learner?: string | null;
};

export function kinderChecklistHref(state: KinderChecklistUrlState): string {
  const sp = new URLSearchParams();
  if (state.schoolId) sp.set("schoolId", state.schoolId);
  if (state.advisory) sp.set("advisory", state.advisory);
  if (state.learner) sp.set("learner", state.learner);
  const qs = sp.toString();
  return qs ? `${KINDER_TERMS_REPORTS_PATH}?${qs}` : KINDER_TERMS_REPORTS_PATH;
}
