import { flushSync } from "react-dom";

/**
 * The light/dark switch animation: the new theme grows out of the toggle as
 * one circle over the live page. It starts slowly, speeds up as it spreads,
 * and eases out as it reaches the far corner.
 *
 * The swap runs inside a View Transition, so the browser keeps a picture of
 * the old page while the new page is revealed through a growing clip-path.
 * Without View Transitions, or with reduced motion, the theme swaps instantly.
 */

export type WaveOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

const REVEAL_MS = 780;
/** Slow start, long acceleration, short soft landing. */
const EASE = "cubic-bezier(0.75, 0, 0.25, 1)";

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
        { duration: REVEAL_MS, easing: EASE, fill: "forwards", pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // The swap already happened; only the reveal was skipped.
    });
}
