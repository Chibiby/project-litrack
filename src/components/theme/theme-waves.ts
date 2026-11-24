import { flushSync } from "react-dom";
import { blobRevealFrames, makeBlobSeed } from "./theme-blob";

/**
 * The light/dark switch animation: the new theme grows out of the toggle over
 * the live page, through a wavy, ever-moving edge that is new on every switch
 * (`theme-blob.ts`), or a plain circle where `clip-path: path()` is missing.
 * It starts very slowly and speeds up until the halfway point of the old 780ms
 * reveal, then holds that speed to the far corner, so it never rushes at the
 * end.
 *
 * The swap runs inside a View Transition, so the browser keeps a picture of
 * the old page while the new page is revealed through a growing clip-path.
 * Without View Transitions, or with reduced motion, the theme swaps instantly.
 */

export type WaveOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

/**
 * Set on <html> while a reveal runs (see globals.css). The revealed page is a
 * live view, not a picture: without this, the light rays keep moving and
 * every colour transition keeps fading under the edge, so the browser
 * re-blurs every glass card on every frame and the reveal drops frames,
 * worse with each quick switch. Holding the page still lets it paint once.
 */
export const THEME_SWITCHING_CLASS = "theme-switching";

/** Only the newest switch may clear the class; an older one ends early. */
let latestSwitch = 0;

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

/** `clip-path: path()` is needed for the wavy edge; older browsers get the circle. */
function supportsPathClip(): boolean {
  return typeof CSS !== "undefined" && !!CSS.supports?.("clip-path", 'path("M0 0L1 0L1 1Z")');
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

  // Build the frames before the switch, so nothing is computed between the
  // snapshot and the first frame.
  const frames = supportsPathClip() ? blobRevealFrames(x, y, radius, makeBlobSeed()) : null;
  const root = document.documentElement;
  const id = ++latestSwitch;
  root.classList.add(THEME_SWITCHING_CLASS);

  const transition = doc.startViewTransition(() => flushSync(swap));
  transition.finished
    .catch(() => undefined)
    .then(() => {
      if (id === latestSwitch) root.classList.remove(THEME_SWITCHING_CLASS);
    });
  transition.ready
    .then(() => {
      const target = { fill: "forwards" as const, pseudoElement: "::view-transition-new(root)" };
      if (frames) {
        // A wavy edge with a fresh random seed each switch (theme-blob.ts).
        // The radius curve is baked into the frames, so they play linearly.
        root.animate({ clipPath: frames }, { ...target, duration: REVEAL_MS, easing: "linear" });
        return;
      }
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { ...revealTiming(), ...target }
      );
    })
    .catch(() => {
      // The swap already happened; only the reveal was skipped.
    });
}
