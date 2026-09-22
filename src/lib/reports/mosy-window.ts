import {
  TermWindowOverrideInput,
  getTermWindows,
  resolveTermWindow,
} from "@/lib/terms/windows";

/**
 * MOSY — "Middle of School Year" — is defined as the school year's Second
 * Term window. Exported as a constant rather than the literal `"SECOND"`
 * wherever it is needed, so a report that asks "which term is MOSY" and the
 * term-window code that already answers "what dates is the Second Term"
 * cannot drift apart.
 */
export const MOSY_TERM = "SECOND" as const;

export type MosyWindow = {
  /** Local `YYYY-MM-DD` of the first day of the MOSY window. */
  startKey: string;
  /** Local `YYYY-MM-DD` of the last day of the MOSY window. */
  endKey: string;
  /** "November - January" — reused verbatim from the term window's own range label. */
  label: string;
};

/**
 * The MOSY date window for a school year, honouring any `TermWindowOverride`
 * a School Head has set for the Second Term.
 *
 * A thin wrapper over `resolveTermWindow(getTermWindows(...), MOSY_TERM)`
 * rather than a parallel calculation — `getTermWindows` already resolves the
 * UTC-shift hazard on `SchoolYear.startDate` and already applies overrides,
 * so recomputing either rule here would be a second answer to a question
 * `src/lib/terms/windows.ts` already answers.
 */
export function resolveMosyWindow(
  schoolYearStart: Date,
  overrides: TermWindowOverrideInput[] = []
): MosyWindow {
  const windows = getTermWindows(schoolYearStart, overrides);
  const mosy = resolveTermWindow(windows, MOSY_TERM);

  // `resolveTermWindow` only returns null for a term name it does not know;
  // `MOSY_TERM` is one of `getTermWindows`'s own `TERM_PERIODS`, so this
  // never fires outside a future refactor breaking that invariant.
  if (!mosy) {
    throw new Error(`resolveMosyWindow: no window found for term "${MOSY_TERM}"`);
  }

  return {
    startKey: mosy.startKey,
    endKey: mosy.endKey,
    label: mosy.rangeLabel,
  };
}
