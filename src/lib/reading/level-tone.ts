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
  "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300",
  "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
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
