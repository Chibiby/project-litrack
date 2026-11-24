"use client";

import { useLayoutEffect, useRef } from "react";
import {
  COUNT_UP_MS,
  countUpFrame,
  createCountUpGate,
  parseCountable,
  resetCountUp,
} from "@/lib/ui/count-up";

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const shouldCount = createCountUpGate(sessionStore, () => performance.now());

/** Call on a fresh sign-in, so every page counts once again. */
export function resetCountUpForSignIn(): void {
  resetCountUp(sessionStore());
}

/**
 * A stat figure that counts up from 0 the first time its page is opened in a
 * sign-in. React always renders the final value (server and client); when the
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
    if (!shouldCount(window.location.pathname)) return;

    const { target, format } = c;
    const end = format(target);
    const start = performance.now();
    let frame = 0;
    el.textContent = format(0);
    const tick = (now: number) => {
      const n = countUpFrame(target, now - start, COUNT_UP_MS);
      el.textContent = format(n);
      if (n !== target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
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
