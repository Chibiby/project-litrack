"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { EASE, MOTION_MS } from "@/lib/ui/motion";

/**
 * One glass pill behind the sidebar's active row. It slides up or down
 * to the row you click (ease-in-out) instead of each row painting its own
 * highlight, so the eye follows the move.
 *
 * Render it as a direct child of the positioned nav list. It finds the row
 * marked `data-nav-active="true"` inside that parent and moves itself there by
 * writing `transform` and `height` straight to its own style: no React state,
 * so no extra render per move. The first placement skips the transition, so
 * the pill appears in place on load rather than sliding in from the top.
 * A ResizeObserver keeps it aligned when the rail collapses or reflows.
 */
export function NavGlassIndicator({
  activeKey,
  className,
}: {
  /** Changes whenever the active row changes; triggers a re-measure. */
  activeKey: string | null | undefined;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const pill = ref.current;
    const list = pill?.parentElement;
    if (!pill || !list) return;

    const place = (animate: boolean) => {
      const row = list.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!row) {
        pill.style.opacity = "0";
        return;
      }
      const listBox = list.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      pill.style.transition = animate
        ? `transform ${MOTION_MS.slow}ms ${EASE.standard}, height ${MOTION_MS.slow}ms ${EASE.standard}, opacity ${MOTION_MS.base}ms ${EASE.standard}`
        : "none";
      pill.style.height = `${rowBox.height}px`;
      pill.style.left = `${rowBox.left - listBox.left}px`;
      pill.style.width = `${rowBox.width}px`;
      pill.style.transform = `translateY(${rowBox.top - listBox.top}px)`;
      pill.style.opacity = "1";
    };

    // Guarded: some environments (jsdom in tests, very old browsers) lack
    // matchMedia or ResizeObserver; the pill still places, just without them.
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    place(placed.current && !reduceMotion);
    placed.current = true;

    // Re-place only when the list really changes size (rail collapsing, a
    // group reflowing). ResizeObserver also fires once right after observe();
    // that call must not snap the pill mid-slide, so it is skipped.
    //
    // While the rail's width animates, the observer fires on every frame.
    // Measuring and moving the pill each time forced a layout per frame and
    // made the collapse stutter, so the pill hides for the resize and is
    // placed once, after the size has stopped changing.
    if (typeof ResizeObserver === "undefined") return;
    let last = `${list.offsetWidth}x${list.offsetHeight}`;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      // Layout is already clean when the observer runs, so this read is free.
      const size = `${list.offsetWidth}x${list.offsetHeight}`;
      if (size === last) return;
      last = size;
      pill.style.transition = "opacity 120ms ease-out";
      pill.style.opacity = "0";
      clearTimeout(settle);
      settle = setTimeout(() => place(false), 140);
    });
    observer.observe(list);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
    };
  }, [activeKey]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-0 rounded-xl opacity-0",
        // A brighter pane of the same glass the rail is made of: a denser
        // white fill, a bright border and a top-edge highlight, so the pill
        // stands out on the frosted rail instead of vanishing into it. Still
        // no accent colour.
        "border border-white/80 bg-glass/60 shadow-indicator backdrop-blur-md",
        "dark:border-white/15 dark:bg-glass/[0.12]",
        className
      )}
    />
  );
}
