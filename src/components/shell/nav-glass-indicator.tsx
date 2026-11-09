"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

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
        ? "transform 380ms cubic-bezier(0.65, 0, 0.35, 1), height 380ms cubic-bezier(0.65, 0, 0.35, 1), opacity 200ms ease-in-out"
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
    if (typeof ResizeObserver === "undefined") return;
    let last = `${list.offsetWidth}x${list.offsetHeight}`;
    const observer = new ResizeObserver(() => {
      const size = `${list.offsetWidth}x${list.offsetHeight}`;
      if (size === last) return;
      last = size;
      place(false);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeKey]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-0 rounded-xl opacity-0",
        // Plain glassmorphism: a translucent white fill, a thin light border,
        // a backdrop blur and a soft shadow. No accent colour, no rim
        // highlights.
        "border border-white/40 bg-glass/25 shadow-[0_4px_16px_rgb(15_23_42/0.08)] backdrop-blur-md",
        "dark:border-white/10 dark:bg-glass/10 dark:shadow-[0_4px_16px_rgb(0_0_0/0.3)]",
        className
      )}
    />
  );
}
