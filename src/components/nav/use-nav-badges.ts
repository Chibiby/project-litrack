"use client";

import { useEffect, useState } from "react";
import type { NavBadges } from "@/lib/nav/nav-config";

/** How often the admin consoles re-read the Support badge (spec: approach C). */
export const NAV_BADGE_POLL_MS = 30_000;

async function fetchNavBadges(): Promise<NavBadges | null> {
  try {
    const res = await fetch("/api/nav/badges", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; data?: NavBadges };
    return body.ok && body.data ? body.data : null;
  } catch {
    // Offline, signed out (an HTML page), or the server is busy: a badge is a
    // hint, so keep the last counts and try again next tick.
    return null;
  }
}

/**
 * The sidebar's badge counts. `source` comes from the role layout: a plain
 * object, or a promise streamed after the chrome has painted. A new `source`
 * (the layout rendered again — a navigation, or a server action on the page)
 * replaces the counts. With `poll`, the counts are re-read from
 * `/api/nav/badges` every 30 s while the tab is visible and whenever it comes
 * back into view; a poll's keys overwrite, the rest are kept.
 */
export function useNavBadges(
  source: NavBadges | Promise<NavBadges> | undefined,
  poll: boolean
): NavBadges | undefined {
  const [resolved, setResolved] = useState<{ source: typeof source; badges: NavBadges | undefined }>(() => ({
    source,
    badges: source instanceof Promise ? undefined : source,
  }));
  const [polled, setPolled] = useState<{ source: typeof source; badges: NavBadges } | null>(null);

  if (resolved.source !== source) {
    // A pending promise keeps the last counts on screen, so a re-render of the
    // layout (every server action) never blinks the badges off and on.
    setResolved({ source, badges: source instanceof Promise ? resolved.badges : source });
  }

  useEffect(() => {
    if (!(source instanceof Promise)) return;
    let cancelled = false;
    source.then(
      (badges) => {
        if (!cancelled) setResolved({ source, badges });
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void fetchNavBadges().then((badges) => {
        if (!cancelled && badges) setPolled({ source, badges });
      });
    };
    const timer = window.setInterval(tick, NAV_BADGE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll, source]);

  // A poll taken against an older layout render is stale once the layout
  // hands over new counts.
  const live = polled && polled.source === source ? polled.badges : null;
  if (!live) return resolved.badges;
  return { ...resolved.badges, ...live };
}
