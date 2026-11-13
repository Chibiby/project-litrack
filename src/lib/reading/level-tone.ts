/**
 * The colour ramp shared by the monthly reading-level grid and its legend, so
 * a value always paints the same colour wherever it is shown. Extracted
 * unchanged from `aral-monthly-reading-level-grid-form.tsx` — byte-identical
 * values, no behaviour change.
 *
 * Low band → rose, top band → emerald, and empty keeps the neutral input tone
 * so an unassessed cell never looks like a score.
 */
export const TONE_EMPTY = "border-input bg-background text-muted-foreground";

export const TONE_RAMP = [
  "border-danger-300 bg-danger-50 text-danger-700 dark:border-danger-900 dark:bg-danger-950 dark:text-danger-300",
  "border-warning-300 bg-warning-50 text-warning-700 dark:border-warning-900 dark:bg-warning-950 dark:text-warning-300",
  "border-info-300 bg-info-50 text-info-700 dark:border-info-900 dark:bg-info-950 dark:text-info-300",
  "border-success-300 bg-success-50 text-success-700 dark:border-success-900 dark:bg-success-950 dark:text-success-300",
];

/**
 * "Not applicable" is a recorded answer, not a blank, so it reads as a filled
 * chip against the empty cell's bare ground and carries full-strength text
 * instead of the placeholder's muted tone. Semantic tokens rather than a slate
 * ramp: they invert with the theme on their own, which is the whole point of the
 * palette rule — and it matches `reading-band-pill`'s neutral, so "no value
 * here" looks the same wherever it appears.
 */
export const TONE_NA = "border-border bg-muted text-foreground";

/**
 * A cell's tint comes from where its value sits on that field's OWN scale, not
 * from a shared level number. Reading comprehension tops out at Level 3 and word
 * recognition at Level 5; ranking each within its own range is what stops "the
 * best available answer" from rendering as mid-amber in one column and emerald in
 * the next.
 */
export function rampTone(index: number, count: number): string {
  if (count <= 1) return TONE_RAMP[TONE_RAMP.length - 1];
  const fraction = index / (count - 1);
  const slot = Math.min(
    TONE_RAMP.length - 1,
    Math.floor(fraction * TONE_RAMP.length)
  );
  return TONE_RAMP[slot];
}
