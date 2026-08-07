/**
 * Minimal page-slot busy state for role `loading.tsx` files.
 *
 * RoleShell (sidebar + header) stays mounted across navigations. A full
 * dashboard skeleton here looked like the layout was being re-measured /
 * rechecked on every page change — keep the slot indicator tiny instead.
 */
export function ContentRouteLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-6 lg:px-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-1 max-w-[12rem] overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/35" />
      </div>
      <span className="sr-only">Loading page</span>
    </div>
  );
}
