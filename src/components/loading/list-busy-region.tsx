"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useListPending } from "@/components/nav/list-navigation";

const OPACITY_RAMP_MS = 100;

export type ListBusyRegionProps = {
  /** Human-readable name for the list, used in the live-region announcement (e.g. "learners"). */
  label: string;
  /**
   * The route's shape-matched skeleton for this list — same column count and
   * row height as `children`, so the swap does not jump. The caller owns the
   * shape; this component does not measure anything.
   */
  skeleton: ReactNode;
  /** The live table/list content, shown when not pending. */
  children: ReactNode;
};

/**
 * Wraps a paginated list panel so a pager/sort/filter/search change — a
 * same-route searchParam change on a `force-dynamic` page, which does not
 * repaint until the RSC response starts arriving — gets instant feedback
 * instead of a frozen table with no sign anything happened.
 *
 * Per product decision, this is "skeleton immediately": as soon as
 * `useListPending()` is true the skeleton replaces the live rows right away,
 * with no slow-load delay gate (that gate exists for a different problem —
 * see `RouteLoadingOverlay` / `SLOW_LOAD_DELAY_MS` — and is deliberately not
 * reused here). Only a short opacity ramp is kept, so a navigation that
 * resolves in under ~50ms does not read as a flicker.
 *
 * Owns exactly ONE polite live region for the whole list, announcing the
 * loading state and the settled state. `aria-live` never goes on the table
 * itself — every cell would re-announce — and the skeleton stays
 * `aria-hidden` throughout.
 */
export function ListBusyRegion({ label, skeleton, children }: ListBusyRegionProps) {
  const pending = useListPending();

  // Render-phase reset, not an effect: the moment `pending` flips we need
  // `ramped` back at false in the very same commit, before the skeleton's
  // first paint, or the opacity-0 starting frame gets skipped and the swap
  // pops instead of ramping in.
  const [prevPending, setPrevPending] = useState(pending);
  const [ramped, setRamped] = useState(false);
  if (pending !== prevPending) {
    setPrevPending(pending);
    setRamped(false);
  }

  // The timer only ever sets state from its own callback, never
  // synchronously in the effect body, so a fast settle can cancel it
  // via the cleanup before the ramp-in ever fires.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setRamped(true), OPACITY_RAMP_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // Same render-phase pattern for "has this region ever announced a
  // loading state" — needed so the settled message only appears after a
  // real navigation, never on first mount.
  const [announced, setAnnounced] = useState(false);
  if (pending && !announced) {
    setAnnounced(true);
  }

  const message = pending ? `Loading ${label}…` : announced ? `${label} updated` : "";

  return (
    <div data-slot="list-busy-region" aria-busy={pending ? "true" : undefined}>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      <div
        style={{
          opacity: pending && !ramped ? 0 : 1,
          transition: `opacity ${OPACITY_RAMP_MS}ms ease-out`,
        }}
      >
        {pending ? skeleton : children}
      </div>
    </div>
  );
}
