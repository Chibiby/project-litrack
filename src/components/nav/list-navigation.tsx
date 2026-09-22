"use client";

import { useLinkStatus } from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
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
 * The flag clears itself when `useSearchParams().toString()` changes: that
 * string changing is direct proof the new server payload has committed to
 * the URL (and therefore the DOM), so there is nothing to time out, retry,
 * or manually reset. No timers, no cleanup races.
 */
type ListNavigationContextValue = {
  pending: boolean;
  setPending: (value: boolean) => void;
};

const ListNavigationContext = createContext<ListNavigationContextValue | null>(null);

export type ListNavigationProviderProps = {
  children: ReactNode;
};

export function ListNavigationProvider({ children }: ListNavigationProviderProps) {
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [pending, setPending] = useState(false);
  const lastParamsKey = useRef(paramsKey);

  useEffect(() => {
    if (lastParamsKey.current === paramsKey) return;
    lastParamsKey.current = paramsKey;
    setPending(false);
  }, [paramsKey]);

  return (
    <ListNavigationContext.Provider value={{ pending, setPending }}>
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
 * `setPending` identity do not re-run on every render.
 */
const NO_PROVIDER: ListNavigationContextValue = Object.freeze({
  pending: false,
  setPending: () => {},
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
  const { setPending } = useListNavigationContext();

  return (href: string) => {
    startTransition(() => {
      setPending(true);
      router.push(href);
    });
  };
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
  const { setPending } = useListNavigationContext();

  useEffect(() => {
    if (pending) setPending(true);
  }, [pending, setPending]);

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
