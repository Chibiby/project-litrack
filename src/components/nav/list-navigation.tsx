"use client";

import { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";

/**
 * Shared "is a list navigation in flight" state for a list panel (pager,
 * sort control, filters, search).
 *
 * `router.push` on a same-route searchParam change does not commit the
 * navigation — and therefore does not update the DOM — until the RSC
 * response starts arriving. On a `force-dynamic` page that means the old
 * table sits on screen, unchanged, for the entire auth + Prisma round trip
 * with no feedback at all. `startTransition`'s `isPending` is the only
 * signal available at t=0, before any network activity, so every control
 * that changes the list ORs its pending state into one shared flag here.
 *
 * The flag is DERIVED from signals that clear themselves — a `useTransition`
 * for programmatic pushes, OR'd with a count of links currently reporting in
 * flight — rather than latched and cleared on a URL change. See the comment
 * inside the provider for why that distinction matters. No timers, no manual
 * reset, and no way for it to stick on.
 */
type ListNavigationContextValue = {
  pending: boolean;
  /** Runs `run` inside the navigation transition whose pending state we expose. */
  startNavigation: (run: () => void) => void;
  /** A `<Link>` reports that it is, or is no longer, navigating. */
  reportLinkPending: (active: boolean) => void;
};

const ListNavigationContext = createContext<ListNavigationContextValue | null>(null);

export type ListNavigationProviderProps = {
  children: ReactNode;
};

export function ListNavigationProvider({ children }: ListNavigationProviderProps) {
  // Pending is DERIVED from live signals, never latched.
  //
  // An earlier version set a boolean `true` on click and cleared it only when
  // `useSearchParams().toString()` changed. That sticks on for any navigation
  // that does not change the URL — submitting the search box with unchanged
  // text, re-applying a filter that is already set — and for any navigation
  // that fails or is aborted. Because `ListBusyRegion` swaps the rows out for
  // a skeleton immediately, a stuck flag means the table's rows disappear and
  // never come back until the user reloads the page. That is a worse outcome
  // than the unresponsive pager this whole feature exists to fix.
  //
  // Both signals below clear themselves: React settles a transition whether
  // the navigation commits, resolves to the same URL, or throws; and a link's
  // report is undone by its own effect cleanup, including on unmount.
  const [isPending, startNavTransition] = useTransition();
  const [linkPendingCount, setLinkPendingCount] = useState(0);

  const startNavigation = useCallback(
    (run: () => void) => startNavTransition(run),
    []
  );

  const reportLinkPending = useCallback((active: boolean) => {
    // Counted, not a boolean: a list can hold several links (Prev, Next and
    // the numbered pages), and a plain flag would let the first one to settle
    // clear a sibling that is still in flight. Floored at zero so an
    // unbalanced report can never drive it negative and wedge it "on".
    setLinkPendingCount((n) => Math.max(0, n + (active ? 1 : -1)));
  }, []);

  const value = useMemo(
    () => ({
      pending: isPending || linkPendingCount > 0,
      startNavigation,
      reportLinkPending,
    }),
    [isPending, linkPendingCount, startNavigation, reportLinkPending]
  );

  return (
    <ListNavigationContext.Provider value={value}>
      {children}
    </ListNavigationContext.Provider>
  );
}

/**
 * The value used when there is no `ListNavigationProvider` above us.
 *
 * These hooks deliberately DO NOT throw when the provider is absent, and that
 * is a load-bearing decision rather than laziness. `SortSelect` and
 * `LearnerPagination` are shared controls already rendered by tables that have
 * not adopted the provider yet — the admin accounts, schools, archive and
 * school-detail tables among them. A throwing hook turns "this table has no
 * instant-feedback wrapper yet" into a hard runtime crash on those pages, and
 * component tests render controls in isolation so they would stay green while
 * the real pages broke. Degrading instead makes adoption purely additive: a
 * wrapped list gets the shared pending state, an unwrapped one keeps exactly
 * the behaviour it had before.
 *
 * Frozen at module scope, not rebuilt per call, so consumers depending on
 * these callbacks' identity do not re-run on every render.
 */
const NO_PROVIDER: ListNavigationContextValue = Object.freeze({
  pending: false,
  // Still runs the navigation — just without a shared pending flag to feed.
  startNavigation: (run: () => void) => run(),
  reportLinkPending: () => {},
});

function useListNavigationContext(): ListNavigationContextValue {
  return useContext(ListNavigationContext) ?? NO_PROVIDER;
}

/**
 * Returns a stable `(href) => void` that pushes the given href inside a
 * transition and feeds `isPending` into the shared pending flag. Callers
 * keep their own href-building logic (pager, sort, filters); this only
 * wraps the push so every control reports into the same place.
 */
export function useListNavigate(): (href: string) => void {
  const router = useRouter();
  const { startNavigation } = useListNavigationContext();

  return useCallback(
    (href: string) => {
      startNavigation(() => router.push(href));
    },
    [router, startNavigation]
  );
}

/** Whether any list navigation (pager, sort, filter, search) is in flight. */
export function useListPending(): boolean {
  const { pending } = useListNavigationContext();
  return pending;
}

const LINK_STATUS_RAMP_MS = 100;

/**
 * Leaf rendered INSIDE a `<Link>` (a descendant, per the `useLinkStatus`
 * contract — it throws outside one). Reports the link's own pending state
 * up to the shared provider and renders a small, fixed-size inline hint so
 * the space is always reserved and nothing shifts when it appears.
 *
 * The hint fades in over ~100ms rather than appearing instantly: a warm,
 * already-prefetched click resolves fast enough that an instant hint would
 * flash for a single frame, which reads as a glitch rather than feedback.
 */
export function LinkStatusPulse() {
  const { pending } = useLinkStatus();
  const { reportLinkPending } = useListNavigationContext();

  // Reports while pending and withdraws the report in cleanup — when the link
  // settles, and also if this control unmounts mid-navigation (which the
  // keyed Suspense boundary does on every commit). An earlier version only
  // ever reported "true", which latched the shared flag on for good if the
  // navigation failed or did not change the URL.
  useEffect(() => {
    if (!pending) return;
    reportLinkPending(true);
    return () => reportLinkPending(false);
  }, [pending, reportLinkPending]);

  return (
    <span
      aria-hidden="true"
      data-slot="link-status-pulse"
      className="ml-1.5 inline-block size-3 shrink-0 align-middle"
      style={{
        opacity: pending ? 1 : 0,
        transition: `opacity ${LINK_STATUS_RAMP_MS}ms ease-out`,
      }}
    >
      <span className="block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </span>
  );
}
