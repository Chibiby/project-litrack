import { flushSync } from "react-dom";

/**
 * The light/dark switch animation: the new theme grows out of the toggle as
 * one circle over the live page. It starts very slowly and speeds up until
 * the halfway point of the old 780ms reveal, then holds that speed to the far
 * corner, so it never rushes at the end.
 *
 * The swap runs inside a View Transition, so the browser keeps a picture of
 * the old page while the new page is revealed through a growing clip-path.
 * Without View Transitions, or with reduced motion, the theme swaps instantly.
 */

export type WaveOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

const REVEAL_MS = 1570;
/**
 * The first quarter is the old `cubic-bezier(0.8, 0, 0.75, 0.5)` over 780ms up
 * to its midpoint (390ms, 10.8% of the radius). From there the circle keeps
 * that midpoint speed instead of accelerating further, which is why the whole
 * reveal now takes 1570ms.
 */
const EASE =
  "linear(0, 0.0007 2.48%, 0.0028 4.96%, 0.0066 7.44%, 0.0123 9.92%, 0.0201 12.40%, " +
  "0.0305 14.88%, 0.0438 17.36%, 0.0607 19.84%, 0.0818 22.33%, 0.1082 24.81%, 1)";
/** Browsers without CSS `linear()` easing keep the old curve and length. */
const FALLBACK = { duration: 780, easing: "cubic-bezier(0.8, 0, 0.75, 0.5)" };

function revealTiming(): { duration: number; easing: string } {
  return typeof CSS !== "undefined" && CSS.supports?.("animation-timing-function", "linear(0, 1)")
    ? { duration: REVEAL_MS, easing: EASE }
    : FALLBACK;
}

export function playThemeWaves(origin: WaveOrigin | undefined, swap: () => void): void {
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!origin || reduced || typeof doc.startViewTransition !== "function") {
    swap();
    return;
  }

  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  const transition = doc.startViewTransition(() => flushSync(swap));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { ...revealTiming(), fill: "forwards", pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // The swap already happened; only the reveal was skipped.
    });
}
