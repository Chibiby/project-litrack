"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav/nav-config";

export type NavLinkIconProps = {
  icon: NavItem["icon"];
  className?: string;
};

/**
 * A nav row's icon, which turns into a spinner while that row's navigation is
 * in flight.
 *
 * The problem it solves: the sidebar's active highlight comes from
 * `usePathname()`, and that does not change until the navigation *commits*. Role
 * pages are `force-dynamic`, so on a cold route the server render sits between
 * the click and the commit — several hundred milliseconds in which the sidebar
 * looked untouched and the click read as dropped. The destination's
 * `loading.tsx` cannot cover that window either: it is the boundary's fallback,
 * so it only paints once the navigation has committed.
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
export function NavLinkIcon({ icon: Icon, className }: NavLinkIconProps) {
  const { pending } = useLinkStatus();

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
