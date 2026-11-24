"use client";

import { useLayoutEffect, useRef } from "react";
import {
  COUNT_UP_MS,
  countUpFrame,
  createCountUpGate,
  createStagger,
  parseCountable,
} from "@/lib/ui/count-up";

const gate = createCountUpGate(() => performance.now());
const stagger = createStagger();

/** Cards that come on screen within this window are ordered as one batch. */
const BATCH_MS = 50;
type Pending = { el: Element; run: () => void; timer: number };
let batch: Pending[] = [];
let batchTimer = 0;

/**
 * Starts the batch in reading order (top to bottom, then left to right),
 * COUNT_UP_STAGGER_MS apart. Cards mount and come on screen in no reliable
 * order, so the order is read from where they sit.
 */
function flushBatch() {
  batchTimer = 0;
  const now = performance.now();
  const ready = batch
    .map((p) => ({ p, r: p.el.getBoundingClientRect() }))
    .sort((a, b) => Math.round(a.r.top / 8) - Math.round(b.r.top / 8) || a.r.left - b.r.left);
  batch = [];
  for (const { p } of ready) p.timer = window.setTimeout(p.run, stagger(now));
}

/** Queues `run` for `el` in the next staggered batch. Returns a cancel. */
function startInOrder(el: Element, run: () => void): () => void {
  const pending: Pending = { el, run, timer: 0 };
  batch.push(pending);
  if (!batchTimer) batchTimer = window.setTimeout(flushBatch, BATCH_MS);
  return () => {
    batch = batch.filter((p) => p !== pending);
    window.clearTimeout(pending.timer);
  };
}

/** Call on a fresh sign-in, so every page counts once again. */
export function resetCountUpForSignIn(): void {
  gate.reset();
}

/**
 * Runs `start` once `el` is on screen (at least half visible). Returns a
 * cancel function.
 */
function whenOnScreen(el: Element, start: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    start();
    return () => undefined;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    },
    { threshold: 0.5 }
  );
  io.observe(el);
  return () => io.disconnect();
}

/**
 * A stat figure that counts up from 0 the first time its page is opened after
 * the app loads (so a refresh counts again), as soon as the card is on screen. Cards that become ready together start
 * COUNT_UP_STAGGER_MS apart. React always renders the final value (server and client); when the
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
    let cancelSeen = () => undefined as void;
    let cancelStart = () => undefined as void;
    el.textContent = format(0);
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const n = countUpFrame(target, now - start, COUNT_UP_MS);
        el.textContent = format(n);
        if (n !== target) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    cancelSeen = whenOnScreen(el, () => {
      cancelStart = startInOrder(el, run);
    });
    return () => {
      cancelSeen();
      cancelStart();
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
