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
  startViewTransition?: (update: () => void) => RunningTransition;
};

type RunningTransition = { ready: Promise<void>; finished: Promise<void>; skipTransition?: () => void };

/**
 * The reveal on screen, if any. A click while it runs ends it at once and
 * swaps back with no animation: two reveals never stack, which is what made
 * rapid switching stutter.
 */
let running: RunningTransition | null = null;

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

/**
 * How long the page stays still after the last reveal ends. Quick back-and-forth
 * switching then never restarts the rays and colour fades between reveals, so
 * each new reveal starts on a page that is already at rest.
 */
export const RESUME_MOTION_MS = 3000;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function holdMotion(root: HTMLElement): void {
  if (resumeTimer !== undefined) clearTimeout(resumeTimer);
  resumeTimer = undefined;
  // Toggling the class restyles the whole page; skip it when already held.
  if (!root.classList.contains(THEME_SWITCHING_CLASS)) root.classList.add(THEME_SWITCHING_CLASS);
}

function resumeMotionLater(root: HTMLElement, id: number): void {
  if (id !== latestSwitch) return;
  if (resumeTimer !== undefined) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    resumeTimer = undefined;
    if (id === latestSwitch) root.classList.remove(THEME_SWITCHING_CLASS);
  }, RESUME_MOTION_MS);
}

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

  const root = document.documentElement;
  if (running) {
    running.skipTransition?.();
    running = null;
    const skippedId = ++latestSwitch;
    holdMotion(root);
    swap();
    resumeMotionLater(root, skippedId);
    return;
  }

  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  // Build the frames before the switch, so nothing is computed between the
  // snapshot and the first frame.
  const frames = supportsPathClip() ? blobRevealFrames(x, y, radius, makeBlobSeed()) : null;
  const id = ++latestSwitch;
  holdMotion(root);

  const transition = doc.startViewTransition(() => flushSync(swap));
  running = transition;
  // The reveal fills forwards so its last frame holds until the transition
  // ends. Left alone it stays attached to <html> after that, and the next
  // reveal then shares the clip-path with it: two clip animations on one
  // layer cannot run on the compositor, so every switch after the first
  // repainted the edge on the main thread and stalled mid-reveal.
  let reveal: Animation | undefined;
  transition.finished
    .catch(() => undefined)
    .then(() => {
      reveal?.cancel();
      if (running === transition) running = null;
      resumeMotionLater(root, id);
    });
  transition.ready
    .then(() => {
      const target = { fill: "forwards" as const, pseudoElement: "::view-transition-new(root)" };
      if (frames) {
        // A wavy edge with a fresh random seed each switch (theme-blob.ts).
        // The radius curve is baked into the frames, so they play linearly.
        reveal = root.animate({ clipPath: frames }, { ...target, duration: REVEAL_MS, easing: "linear" });
        return;
      }
      reveal = root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { ...revealTiming(), ...target }
      );
    })
    .catch(() => {
      // The swap already happened; only the reveal was skipped.
    });
}
