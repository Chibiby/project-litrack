"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Box = { top: number; left: number; width: number; height: number };

/**
 * The sidebar's active-row pill, drawn once and slid between rows instead of
 * each row painting its own background (v2).
 *
 * Render it as the last child of the `<nav>` (a first child would take the
 * nav's space-y margin off the first group): it finds its parent, measures
 * the row marked `data-nav-active`, and moves there with a transform. The nav
 * gets `data-slide="on"` once the pill has a position, which the rows use to
 * drop their own fallback background — so before hydration, or with no
 * JavaScript, the active row is still highlighted by itself.
 *
 * `activeKey` is the only thing that should move it; `collapsed` changes the
 * row geometry, so it re-measures without animating.
 */
export function NavHighlight({
  activeKey,
  collapsed,
}: {
  activeKey: string | null | undefined;
  collapsed: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [animate, setAnimate] = useState(false);
  const lastCollapsed = useRef(collapsed);

  useLayoutEffect(() => {
    const nav = ref.current?.parentElement;
    if (!nav) return;

    const measure = () => {
      const row = nav.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!row) {
        setBox(null);
        nav.removeAttribute("data-slide");
        return;
      }
      const n = nav.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      setBox({ top: r.top - n.top, left: r.left - n.left, width: r.width, height: r.height });
      nav.setAttribute("data-slide", "on");
    };

    // A geometry change (first paint, collapse toggle) snaps into place; only
    // a change of active row slides.
    const geometryChanged = box === null || lastCollapsed.current !== collapsed;
    lastCollapsed.current = collapsed;
    setAnimate(!geometryChanged);
    measure();

    // No ResizeObserver (old browsers, jsdom): the pill still lands on the
    // active row; it just won't follow a later width change until the next click.
    if (typeof ResizeObserver === "undefined") return;

    // ResizeObserver reports once on observe(), in this same frame; acting on
    // that would cancel the slide just started, so only later reports count.
    let initial = true;
    const ro = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      setAnimate(false);
      measure();
    });
    ro.observe(nav);
    return () => ro.disconnect();
    // `box` is read only to detect the first measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, collapsed]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-0 !mt-0 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 shadow-sm shadow-violet-500/30",
        animate && "transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none",
        !box && "opacity-0"
      )}
      style={
        box
          ? {
              transform: `translate(${box.left}px, ${box.top}px)`,
              width: box.width,
              height: box.height,
            }
          : undefined
      }
    />
  );
}
