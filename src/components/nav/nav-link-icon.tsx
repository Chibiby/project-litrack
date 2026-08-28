"use client";

import { useEffect, useRef } from "react";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav/nav-config";

export type NavLinkIconProps = {
  icon: NavItem["icon"];
  className?: string;
  /**
   * Fired once, on the falling edge of this link's pending state — the moment
   * React settles the transition, whether it committed, was superseded by a
   * second click, or ended somewhere off the nav.
   *
   * It exists for the one case the optimistic-highlight rule cannot see: a
   * destination that redirects straight back to where the click was made from
   * never changes the pathname, so `retirePendingNav` never finds the record
   * stale and the row would stay lit for the rest of the session. See
   * `@/lib/nav/pending-nav`.
   */
  onSettled?: () => void;
};

/**
 * A nav row's icon, which turns into a spinner while that row's navigation is
 * in flight.
 *
 * The window it covers: role pages are `force-dynamic`, so on a cold route the
 * server render sits between the click and the commit — several hundred
 * milliseconds. The destination's `loading.tsx` cannot cover it either; it is
 * the boundary's fallback, so it only paints once the navigation has committed.
 *
 * The row's *highlight* no longer waits for that commit — `NavPathProvider`
 * moves it optimistically in the same frame as the click — so this is now the
 * second half of the same answer rather than the whole of it. The highlight says
 * where you are going; the spinner says it has not arrived.
 *
 * `useLinkStatus` is Next's own optimistic pending state for the enclosing
 * `Link`, so the swap happens in the same tick as the click. It must be called
 * from a component *inside* the link, which is the whole reason the icon is its
 * own component rather than a prop on the row.
 *
 * Deliberately framework-managed rather than hand-rolled. The naive version —
 * remember the clicked item, clear it when `usePathname()` catches up — leaves a
 * row spinning forever whenever the pathname never arrives: a click on the
 * current page, a navigation the user interrupts with a second click, a route
 * that redirects somewhere off the nav. Next backs this with `useOptimistic`, so
 * React reverts it when the transition settles however it settles.
 *
 * A warm prefetched route commits in the same transition and never shows the
 * spinner at all, which is why this does not add a flicker to the common case.
 *
 * Silent to assistive tech on purpose. The row is not a live region: the
 * destination boundary announces the wait once it commits (see `BookLoader`),
 * and announcing here as well would report a single navigation twice.
 */
export function NavLinkIcon({ icon: Icon, className, onSettled }: NavLinkIconProps) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);

  // Held in a ref so the effect below depends on `pending` alone. Callers pass an
  // inline arrow that closes over the row's href, so a new identity arrives on
  // every render — as a dependency it would re-run that effect constantly.
  //
  // Written in an effect rather than during render, and declared *above* the one
  // that reads it: effects in a component run in declaration order, so the ref
  // holds this render's callback by the time the falling edge fires.
  const settleRef = useRef(onSettled);
  useEffect(() => {
    settleRef.current = onSettled;
  });

  useEffect(() => {
    // Only the falling edge. A warm prefetched route can commit without ever
    // reporting pending, and firing on a `false` that was never preceded by a
    // `true` would retire the record on mount — killing the optimistic highlight
    // before the pathname had a chance to arrive.
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    settleRef.current?.();
  }, [pending]);

  if (pending) {
    return (
      <Loader2
        // The attribute is the row's hook for its own pending styling: the anchor
        // is this element's ancestor, so it can reach the state with `has-[]`
        // rather than needing the flag lifted up to it.
        data-nav-pending=""
        className={cn(className, "animate-spin")}
        aria-hidden
      />
    );
  }

  return <Icon className={className} />;
}
