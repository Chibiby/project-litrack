/**
 * General Average for one learner's term row.
 *
 * The mean of the FILLED cells only — a blank learning area is "not encoded
 * yet", not a zero, and averaging in a zero would report a passing learner as
 * failing halfway through encoding.
 *
 * Never stored. The grid and the Excel export both call this, so the number on
 * screen and the number in the workbook cannot drift from the cells they came
 * from.
 */
export function generalAverage(
  scores: (number | null | undefined)[]
): number | null {
  const filled = scores.filter(
    (s): s is number => typeof s === "number" && Number.isFinite(s)
  );
  if (filled.length === 0) return null;
  const mean = filled.reduce((sum, s) => sum + s, 0) / filled.length;
  return Math.round(mean * 100) / 100;
}
