"use client";

import { useEffect, useState, type ReactNode } from "react";

import { BookLoader } from "./book-loader";

/**
 * How long a navigation may stay pending before the book animation appears.
 *
 * Short enough that a slow route never sits on a static skeleton, long enough
 * that a warm prefetched route — the common case, since `experimental.staleTimes`
 * keeps dynamic routes for 180s — swaps straight through with the book never
 * rendering at all. Raising this makes slow loads feel unattended; lowering it
 * makes fast ones flash.
 */
export const SLOW_LOAD_DELAY_MS = 500;

export type RouteLoadingOverlayProps = {
  /** The route's shape-matched skeleton. Rendered immediately, and kept. */
  children: ReactNode;
  delayMs?: number;
};

/**
 * Fades the book animation in over a route skeleton that is taking too long.
 *
 * The skeleton stays mounted underneath: it is what keeps layout shift down when
 * the page finally arrives, so it is layered rather than replaced. On a fast
 * navigation this boundary unmounts before the timer fires and the book never
 * appears at all.
 *
 * Scoped to the content slot, not the viewport. `RoleShell` is mounted by the
 * role layout, so on every route below one the sidebar and header are already
 * painted and still interactive while this boundary shows — a `fixed inset-0`
 * scrim would grey out working chrome. `AppShell` is the part that is missing
 * (it is rendered by each `page.tsx`, never by a layout), and that is exactly
 * the region this covers.
 *
 * The tint sits on the full-height absolute layer while the shelf itself sits in
 * a sticky child, so the book stays centred in the viewport on a skeleton taller
 * than the screen without the tint stopping short of the skeleton's bottom.
 */
export function RouteLoadingOverlay({
  children,
  delayMs = SLOW_LOAD_DELAY_MS,
}: RouteLoadingOverlayProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    // The slot is load-bearing, not decoration: this element displaces the
    // skeleton as the boundary's outermost node, and the skeleton root is what
    // owns the route gutter and the `aria-busy` state. Anything walking down
    // from a boundary to find that root keys on this attribute to step past
    // exactly one level — see `boundaryRootOf` in
    // `tests/components/route-loading-shape.test.tsx`.
    <div className="relative" data-slot="route-loading-overlay">
      {children}
      {slow ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 animate-in bg-background/80 fade-in backdrop-blur-[2px] duration-300"
          aria-hidden="true"
        >
          <div className="sticky top-0 flex h-[min(100svh,100%)] min-h-64 items-center justify-center">
            <BookLoader decorative />
          </div>
        </div>
      ) : null}
    </div>
  );
}
