/**
 * The rule for "which path should the chrome draw itself from" while a sidebar
 * click is still in flight.
 *
 * Every role page is `force-dynamic`, so a cold nav row spends several hundred
 * milliseconds between the click and the commit. `usePathname()` does not move
 * until that commit, so keying the sidebar highlight and the header title off it
 * alone leaves both showing the *previous* page for the whole wait — the person
 * clicks Teachers and the rail keeps Dashboard lit. `NavLinkIcon`'s spinner says
 * "something is happening" but not "you are going there".
 *
 * Holding the clicked href here moves the highlight, `aria-current`, and the
 * header title in the same frame as the click. The rules below decide when to
 * stop believing it.
 *
 * React-free on purpose — same reason `resolveActiveItemId` lives in
 * `nav-config.ts` rather than in the sidebar: a route rule with no test is a
 * rule the next person to touch the component quietly breaks.
 */

/** A sidebar click the router has not caught up with yet. */
export interface PendingNav {
  /** The href of the item that was clicked. */
  href: string;
  /** The pathname at the moment of the click. */
  from: string;
}

/**
 * The clicked href while it is still worth showing, or `null` once the router
 * has moved and the real pathname can speak for itself.
 *
 * The test is against `from`, not "have we arrived at `href` yet?". A back
 * button pressed mid-navigation, or a page that redirects somewhere off the nav,
 * moves the URL to a path the clicked item does not cover — and an "arrived?"
 * test would answer no forever and leave the wrong row lit for the rest of the
 * session.
 *
 * That leaves exactly one hole this rule cannot close on its own: a destination
 * that redirects straight back to `from` never changes the pathname, so the
 * record never looks stale. LITRACK has real routes that do this — a Super Admin
 * on `/teacher/aral` clicking End of Terms Reports is bounced back to
 * `/teacher/aral` — which is why the provider also retires the record when the
 * link's own transition settles. See `useNavPath` in
 * `src/components/nav/nav-path.tsx`.
 */
export function pendingNavHref(
  pathname: string,
  pending: PendingNav | null
): string | null {
  if (!pending) return null;
  return pending.from === pathname ? pending.href : null;
}

/**
 * The path the chrome should resolve its active item and title from: the pending
 * click while there is a live one, otherwise the real pathname.
 */
export function resolveNavPath(
  pathname: string,
  pending: PendingNav | null
): string {
  return pendingNavHref(pathname, pending) ?? pathname;
}

/**
 * The record to keep after the pathname has moved: the same one if it is still
 * live, `null` if it has gone stale.
 *
 * Retiring is not the same as ignoring. `resolveNavPath` already ignores a
 * record whose `from` is not the current pathname — but left in place, a record
 * from `/teacher` → `/teacher/learners` would come back to life the moment the
 * teacher returned to `/teacher`, lighting Learners on the dashboard. This is
 * what closes that.
 *
 * It returns the *identical* object when there is nothing to drop, so a state
 * setter fed from it bails out of the update rather than re-rendering.
 */
export function retirePendingNav(
  pathname: string,
  pending: PendingNav | null
): PendingNav | null {
  return pendingNavHref(pathname, pending) === null ? null : pending;
}
