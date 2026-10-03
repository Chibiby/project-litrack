"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type FrameValue = { pending: boolean; activeHref: string | null; go: (href: string) => void };

const FrameContext = createContext<FrameValue | null>(null);

/**
 * One by-school table and its pager. Sorting and paging navigate inside this
 * frame's own transition, deliberately NOT the shared list-navigation one:
 * that one swaps the whole results region for a skeleton, which unmounts the
 * very link that was clicked and drops its pending state. Here the current
 * table stays on screen, dimmed and aria-busy, until the new page arrives.
 */
export function SummaryTableFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeHref, setActiveHref] = useState<string | null>(null);

  // Guard on the transition's own `pending`, not a latch: a push that settles
  // without ever rendering pending must not leave the table's links dead.
  const go = useCallback(
    (href: string) => {
      if (pending) return;
      setActiveHref(href);
      startTransition(() => router.push(href, { scroll: false }));
    },
    [router, pending]
  );

  return (
    <FrameContext.Provider value={{ pending, activeHref, go }}>
      <div
        aria-busy={pending || undefined}
        className={cn("transition-opacity", pending && "opacity-60")}
      >
        {children}
      </div>
    </FrameContext.Provider>
  );
}

/**
 * A real link (open in a new tab works) that, on a plain click, pushes the
 * href without scrolling. Modified clicks fall through to the browser.
 */
export function SummaryTableNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const frame = useContext(FrameContext);
  const active = Boolean(frame?.pending && frame.activeHref === href);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !frame ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    frame.go(href);
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-busy={active || undefined}
      aria-disabled={frame?.pending && !active ? true : undefined}
      className={className}
    >
      {children}
      <span aria-hidden className="inline-block size-3 shrink-0" style={{ opacity: active ? 1 : 0 }}>
        <span className="block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </span>
    </a>
  );
}
