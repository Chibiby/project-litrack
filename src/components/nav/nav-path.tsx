"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import {
  resolveNavPath,
  retirePendingNav,
  type PendingNav,
} from "@/lib/nav/pending-nav";

/**
 * The optimistic navigation path, shared by the two pieces of chrome that draw
 * themselves from the URL: the sidebar's active row and the header's title.
 *
 * They are siblings under `RoleShell` / `AppShellFallback` with no prop path
 * between them, and they must not disagree — a rail that jumps to Teachers while
 * the header still says Dashboard is worse than both of them waiting. So the
 * pending click lives here, above both.
 *
 * Rules about *which* path wins live in `@/lib/nav/pending-nav`, not in this
 * file and not in the sidebar.
 */

interface NavPathValue {
  /** The path the chrome should resolve its active item and title from. */
  navPath: string;
  /** Record a click that the router has not caught up with yet. */
  markPending: (href: string) => void;
  /**
   * Retire the record for `href`, if it is still the live one. Called when a
   * link's own transition settles — however it settles.
   */
  clearPending: (href: string) => void;
}

const NavPathContext = createContext<NavPathValue | null>(null);

export function NavPathProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingNav | null>(null);

  useEffect(() => {
    // The functional updater is what keeps `pending` out of the dependency list.
    // Depending on it would run this the instant a click set it and clear the
    // highlight before the navigation had finished, which is the entire
    // behaviour this state exists to provide.
    //
    // `retirePendingNav` returns the identical object when there is nothing to
    // drop, and React bails out of a state update that changes nothing — so this
    // re-renders once per navigation, on the render that hands the highlight
    // back to the real pathname.
    setPending((current) => retirePendingNav(pathname, current));
  }, [pathname]);

  const markPending = useCallback(
    (href: string) => {
      // `from` is read at the click, so the record can tell later whether the
      // router has moved. A second click simply replaces the first: the latest
      // intent is the one worth drawing.
      setPending({ href, from: pathname });
    },
    [pathname]
  );

  const clearPending = useCallback((href: string) => {
    // Guarded on href because settle callbacks race clicks: click A, then click
    // B before A commits, and A's transition settles as superseded. Clearing
    // unconditionally there would drop B's record and snap the highlight back.
    setPending((current) => (current?.href === href ? null : current));
  }, []);

  const value = useMemo<NavPathValue>(
    () => ({
      navPath: resolveNavPath(pathname, pending),
      markPending,
      clearPending,
    }),
    [pathname, pending, markPending, clearPending]
  );

  return <NavPathContext.Provider value={value}>{children}</NavPathContext.Provider>;
}

/**
 * Degrades to the real pathname rather than throwing when there is no provider.
 * The sidebar is the only consumer that can plausibly be mounted on its own, and
 * "the highlight moves on arrival instead of on click" is the behaviour this
 * whole module replaced — a correct, slower fallback, not a broken one.
 */
export function useNavPath(): NavPathValue {
  const pathname = usePathname();
  const context = useContext(NavPathContext);

  const fallback = useMemo<NavPathValue>(
    () => ({ navPath: pathname, markPending: () => {}, clearPending: () => {} }),
    [pathname]
  );

  return context ?? fallback;
}
