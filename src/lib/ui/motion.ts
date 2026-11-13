/**
 * The app's motion values for code that cannot read CSS variables: the Web
 * Animations API (`el.animate`) and inline `style.transition` strings.
 *
 * Keep these in step with globals.css (`--motion-*`, `--ease-*`), which
 * Tailwind reads as `duration-fast|base|slow` and `ease-standard|slide|bounce`.
 * Class names are the first choice; use these only from script.
 */
export const MOTION_MS = {
  fast: 150,
  base: 220,
  slow: 420,
} as const;

export const EASE = {
  /** Most UI changes: decelerates, no overshoot. */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** Page and step slides: fast start, long settle (the sign-in step slide). */
  slide: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** A small overshoot for a success pop. */
  bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;
