"use client";

import { useLayoutEffect, useRef } from "react";
import { COUNT_UP_MS, countUpFrame, createCountUpGate, parseCountable } from "@/lib/ui/count-up";

const gate = createCountUpGate(() => performance.now());

/** Call on a fresh sign-in, so every page counts once again. */
export function resetCountUpForSignIn(): void {
  gate.reset();
}

/** Anything still loading: the sign-in splash, skeletons, busy regions. */
const LOADING = "[data-post-login-splash], main .animate-pulse, main [aria-busy=\"true\"]";
/** A pop-up over the page (such as the update notice) hides the cards. */
const COVERED = "[role=\"dialog\"], [role=\"alertdialog\"]";
/** How long the page must stay loaded and visible before the count starts. */
const SETTLE_MS = 450;
/** Skeletons that never go away do not hold the count back past this. */
const MAX_LOADING_WAIT_MS = 8000;

/**
 * Runs `start` once the whole page has loaded, nothing on it is still
 * loading, no pop-up covers it, and the tab is visible, after that has held for SETTLE_MS.
 * Returns a cancel function.
 */
function whenPageSettled(start: () => void): () => void {
  const begun = performance.now();
  let settledSince: number | null = null;
  let timer = 0;
  const check = () => {
    const now = performance.now();
    const loading = now - begun < MAX_LOADING_WAIT_MS && document.querySelector(LOADING) !== null;
    const ready =
      document.readyState === "complete" &&
      document.visibilityState === "visible" &&
      !loading &&
      document.querySelector(COVERED) === null;
    settledSince = ready ? (settledSince ?? now) : null;
    if (settledSince !== null && now - settledSince >= SETTLE_MS) return start();
    timer = window.setTimeout(check, 100);
  };
  check();
  return () => window.clearTimeout(timer);
}

/**
 * A stat figure that counts up from 0 the first time its page is opened after
 * the app loads (so a refresh counts again), once the page has finished
 * loading. React always renders the final value (server and client); when the
 * page should count, a layout effect rewrites the digits before the first
 * paint and steps them on each animation frame. That is a direct DOM write,
 * not state: sixty renders a second per card would be wasted work, and the
 * final value stays what React owns.
 *
 * The visible digits are `aria-hidden` while an sr-only copy always holds the
 * final value, so a screen reader never reads a half-counted number.
 */
export function CountUp({ value }: { value: number | string }) {
  const digits = useRef<HTMLSpanElement>(null);
  const countable = parseCountable(value);
  const final = countable ? countable.format(countable.target) : String(value);

  useLayoutEffect(() => {
    const el = digits.current;
    const c = parseCountable(value);
    if (!el || !c || c.target === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!gate.shouldCount(window.location.pathname)) return;

    const { target, format } = c;
    const end = format(target);
    let frame = 0;
    el.textContent = format(0);
    const cancelWait = whenPageSettled(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const n = countUpFrame(target, now - start, COUNT_UP_MS);
        el.textContent = format(n);
        if (n !== target) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelWait();
      cancelAnimationFrame(frame);
      el.textContent = end;
    };
  }, [value]);

  if (!countable) return <>{final}</>;
  return (
    <>
      <span ref={digits} aria-hidden>
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </>
  );
}
