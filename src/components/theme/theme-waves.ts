import { flushSync } from "react-dom";

/**
 * The light/dark switch animation: three stacked ripples spread from the
 * toggle. Each ripple sits on top of the one outside it and casts a shadow
 * onto it:
 *
 *   1. outer ring: the new background colour, lightly tinted over the old page;
 *   2. middle ring: the same colour, stronger;
 *   3. the new page itself, revealed as a sharp circle.
 *
 * The page stays visible throughout: the rings are translucent, and the reveal
 * shows the real new page, not a flat colour. Edges are crisp; the depth comes
 * from shadows, not blur.
 *
 * How: the swap runs inside a View Transition. Inside the update the rings are
 * mounted with their own `view-transition-name`, so they paint above the page.
 * Every layer is driven by keyframes sampled from one timeline, so their edges
 * meet exactly on every frame. Without View Transitions, or with reduced
 * motion, the theme swaps instantly.
 */

export type WaveOrigin = { x: number; y: number };

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

/** Each ripple's own travel time. */
const WAVE_MS = 820;
/** Gap between ripples leaving the toggle. */
const STAGGER_MS = 130;
const TOTAL_MS = WAVE_MS + STAGGER_MS * 2;
/** Keyframes per animation; sampled so every layer follows one shared clock. */
const SAMPLES = 48;
/** Strong ease in and out: a gathering start, a rush, a soft landing. */
const BEZIER = [0.7, 0, 0.2, 1] as const;
/** Ring tints over the old page, outer then middle. */
const RING_ALPHA = [0.42, 0.72] as const;
const SHADOW = "0 0 0 1px rgb(255 255 255 / 0.10), 0 10px 28px -4px rgb(0 0 0 / 0.38), 0 2px 6px rgb(0 0 0 / 0.22)";

const NAME = "theme-ripples";

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

function backgroundHsl(dark: boolean): string {
  const root = document.documentElement;
  const had = root.classList.contains("dark");
  // One synchronous read with the class flipped: no frame paints in between.
  root.classList.toggle("dark", dark);
  const value = getComputedStyle(root).getPropertyValue("--background").trim();
  root.classList.toggle("dark", had);
  return value || (dark ? "222 47% 7%" : "214 53% 96%");
}

function ringElement(style: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;box-sizing:border-box;border-radius:9999px;border-style:solid;box-shadow:${SHADOW};${style}`;
  return el;
}

export function playThemeWaves(origin: WaveOrigin | undefined, toDark: boolean, swap: () => void): void {
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!origin || reduced || typeof doc.startViewTransition !== "function") {
    swap();
    return;
  }

  document.getElementById(NAME)?.remove();

  const { x, y } = origin;
  // Past the farthest corner, plus room for the shadows to leave the screen.
  const end =
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 48;
  const ease = cubicBezier(...BEZIER);
  const radiusAt = (ms: number, wave: number) =>
    end * ease(Math.min(1, Math.max(0, (ms - wave * STAGGER_MS) / WAVE_MS)));

  // r[0] outer ring, r[1] middle ring, r[2] the new page, per sample.
  const frames = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const ms = (i / SAMPLES) * TOTAL_MS;
    return [radiusAt(ms, 0), radiusAt(ms, 1), radiusAt(ms, 2)];
  });
  const circleFrame = (r: number, inner: number) => ({
    left: `${x - r}px`,
    top: `${y - r}px`,
    width: `${r * 2}px`,
    height: `${r * 2}px`,
    borderWidth: `${Math.max(0, r - inner)}px`,
  });

  const tint = backgroundHsl(toDark);
  const overlay = document.createElement("div");
  overlay.id = NAME;
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;view-transition-name:${NAME}`;
  const outer = ringElement(`border-color:hsl(${tint} / ${RING_ALPHA[0]})`);
  const middle = ringElement(`border-color:hsl(${tint} / ${RING_ALPHA[1]})`);
  // The new page's rim: a transparent circle whose outer shadow falls on the middle ring.
  const rim = ringElement("border-width:0");

  const transition = doc.startViewTransition(() => {
    flushSync(swap);
    overlay.append(outer, middle, rim);
    document.body.appendChild(overlay);
  });

  const timing = { duration: TOTAL_MS, easing: "linear", fill: "forwards" as const };
  transition.ready
    .then(() => {
      outer.animate(frames.map(([a, b]) => circleFrame(a, b)), timing);
      middle.animate(frames.map(([, b, c]) => circleFrame(b, c)), timing);
      rim.animate(frames.map(([, , c]) => circleFrame(c, c)), timing);
      document.documentElement.animate(
        { clipPath: frames.map(([, , c]) => `circle(${c}px at ${x}px ${y}px)`) },
        { ...timing, pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // The swap already happened; only the ripples were skipped.
    });
  transition.finished.finally(() => overlay.remove());
}
