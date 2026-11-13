import { EASE } from "@/lib/ui/motion";
/**
 * Button press feel (operator reference video, "Sink, then spring"): on press
 * the button sinks to 95% and a soft circle spreads from the press point; on
 * release it springs back past full size and settles. And "Draw the win": a
 * save that succeeded draws a ring, then a tick, on the button itself.
 *
 * Everything here is plain DOM so `Button` can stay a server-safe component:
 * it only marks itself with `data-press` (and `data-save`), and the one client
 * listener (`PressFeedback`) drives these helpers. Nothing runs under
 * prefers-reduced-motion.
 */

export const PRESS_SCALE = 0.95;
export const PRESS_DOWN_MS = 110;
export const PRESS_SPRING_MS = 640;
export const RIPPLE_MS = 620;
export const SAVED_HOLD_MS = 1600;

export type PressTone = "light" | "dark";

/**
 * Samples an under-damped spring from `from` to `to` as evenly spaced
 * keyframe values (WAAPI plays them linearly, so this works in every browser,
 * unlike CSS `linear()`). damping 0.32 overshoots by about a third of the
 * distance: 0.95 -> about 1.017, the bump in the reference curve.
 */
export function springValues(
  from: number,
  to: number,
  { damping = 0.32, cycles = 1.9, steps = 28 }: { damping?: number; cycles?: number; steps?: number } = {},
): number[] {
  const omega = 2 * Math.PI * cycles;
  const omegaD = omega * Math.sqrt(1 - damping * damping);
  const values: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const decay = Math.exp(-damping * omega * t);
    const x = decay * (Math.cos(omegaD * t) + ((damping * omega) / omegaD) * Math.sin(omegaD * t));
    values.push(to + (from - to) * x);
  }
  values[values.length - 1] = to;
  return values;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Current rendered `scale` of the element (1 when none or not parseable). */
function currentScale(el: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(el).scale);
  return Number.isFinite(value) ? value : 1;
}

/**
 * Uses the individual `scale` property, not `transform`, so a caller's own
 * translate/rotate classes (e.g. a centred icon button) are left alone.
 */
export function sink(el: HTMLElement): void {
  if (typeof el.animate !== "function") return;
  el.animate([{ scale: String(currentScale(el)) }, { scale: String(PRESS_SCALE) }], {
    duration: PRESS_DOWN_MS,
    easing: EASE.standard,
    fill: "forwards",
  });
}

export function springBack(el: HTMLElement): void {
  if (typeof el.animate !== "function") return;
  const start = currentScale(el);
  el.getAnimations?.().forEach((a) => a.cancel());
  el.animate(
    springValues(start, 1).map((v) => ({ scale: String(v) })),
    { duration: PRESS_SPRING_MS, easing: "linear" },
  );
}

/** Ripple diameter: twice the distance from the press point to the farthest corner. */
export function rippleSize(rect: { width: number; height: number }, x: number, y: number): number {
  const dx = Math.max(x, rect.width - x);
  const dy = Math.max(y, rect.height - y);
  return 2 * Math.hypot(dx, dy);
}

const HOST = "data-press-host";

function rippleHost(el: HTMLElement): HTMLElement {
  const existing = Array.from(el.children).find((c) => c.hasAttribute(HOST));
  if (existing) return existing as HTMLElement;
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  const host = document.createElement("span");
  host.setAttribute(HOST, "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;";
  el.appendChild(host);
  return host;
}

/** Spreads a soft circle from (clientX, clientY); white on filled buttons. */
export function ripple(el: HTMLElement, clientX: number, clientY: number, tone: PressTone): void {
  if (typeof el.animate !== "function") return;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const size = rippleSize(rect, x, y);
  const dot = document.createElement("span");
  dot.style.cssText = [
    "position:absolute",
    `left:${x - size / 2}px`,
    `top:${y - size / 2}px`,
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:9999px",
    "pointer-events:none",
    tone === "light" ? "background:rgb(255 255 255 / 0.38)" : "background:currentColor",
  ].join(";");
  rippleHost(el).appendChild(dot);
  const peak = tone === "light" ? 1 : 0.14;
  const anim = dot.animate(
    [
      { transform: "scale(0)", opacity: peak },
      { transform: "scale(0.7)", opacity: peak, offset: 0.55 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: RIPPLE_MS, easing: EASE.standard },
  );
  const remove = () => dot.remove();
  anim.onfinish = remove;
  anim.oncancel = remove;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * "Draw the win": hides the button's own label, draws a ring then a tick with
 * "Saved" beside it, holds, and restores. Styles live in globals.css
 * (`.press-saved*`). Returns the overlay so a caller (or test) can remove it.
 */
export function showSaved(el: HTMLElement, label = "Saved"): HTMLElement {
  el.querySelector(":scope > [data-press-saved]")?.remove();
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.style.setProperty("--press-saved-color", getComputedStyle(el).color);

  const overlay = document.createElement("span");
  overlay.setAttribute("data-press-saved", "");
  overlay.className = "press-saved";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "press-saved-icon");
  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", "12");
  ring.setAttribute("cy", "12");
  ring.setAttribute("r", "10");
  ring.setAttribute("pathLength", "1");
  ring.setAttribute("class", "press-saved-ring");
  const tick = document.createElementNS(SVG_NS, "path");
  tick.setAttribute("d", "M7.5 12.5l3 3 6-6.5");
  tick.setAttribute("pathLength", "1");
  tick.setAttribute("class", "press-saved-tick");
  svg.append(ring, tick);
  const text = document.createElement("span");
  text.className = "press-saved-text";
  text.textContent = label;
  overlay.append(svg, text);

  el.setAttribute("data-press-saved-on", "");
  el.appendChild(overlay);
  window.setTimeout(() => {
    overlay.remove();
    el.removeAttribute("data-press-saved-on");
  }, SAVED_HOLD_MS);
  return overlay;
}
