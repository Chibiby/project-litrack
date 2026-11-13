"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dismissAralAssignmentAlerts,
  fetchAralAssignmentAlerts,
} from "@/lib/actions/notifications";
import { isActionFailure } from "@/lib/errors/client";
import { callAction } from "@/lib/ui/call-action";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";

/** Shape comes from the action, so this cannot drift from what the server sends. */
type Alert = Awaited<ReturnType<typeof fetchAralAssignmentAlerts>>[number];

const ARAL_ROSTER_HREF = "/teacher/aral";

/** How often to re-check whether the login splash still covers the screen. */
const COVER_POLL_MS = 250;
/**
 * Stop waiting for the splash regardless. Its own hard cap is 8s; if something
 * has gone wrong and the cover never lifts, a late alert still beats none.
 */
const COVER_WAIT_CAP_MS = 10_000;

/**
 * Tells a teacher, on their next screen, that someone designated them the ARAL
 * teacher for one or more learners.
 *
 * Mounted once in the teacher layout, so it fires on entry into `/teacher` and
 * not again on in-app navigation. It takes no props and fetches from the client
 * after paint on purpose: everything the layout awaits blocks the sidebar and
 * header for every `/teacher` route, and a courtesy message must not buy a
 * longer blank-shell flash. Nothing renders until there is something to say.
 *
 * Closing the dialog *is* the acknowledgement — ✕, Esc, the overlay, Dismiss and
 * the roster link all mark the same alerts read through one `onOpenChange`, so
 * there is no way to see the message and still be shown it again.
 */
export function AralAssignmentAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  /** Dismissal is fire-and-forget, so guard against a double send. */
  const dismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pollId: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + COVER_WAIT_CAP_MS;

    const load = async () => {
      if (cancelled) return;
      const rows = await callAction(() => fetchAralAssignmentAlerts());
      if (cancelled || isActionFailure(rows) || rows.length === 0) return;
      setAlerts(rows);
      setOpen(true);
    };

    // The splash owns the screen at z-9999 for its first seconds. Opening under
    // it would trap focus behind a cover the teacher cannot see past, so wait it
    // out — via the shared flag, not by reaching into that component.
    const whenUncovered = () => {
      if (cancelled) return;
      if (isPostLoginLoadingCover() && Date.now() < deadline) {
        pollId = setTimeout(whenUncovered, COVER_POLL_MS);
        return;
      }
      void load();
    };

    const afterPaint = () => {
      if (cancelled) return;
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(whenUncovered, { timeout: 1500 });
      } else {
        timeoutId = setTimeout(whenUncovered, 200);
      }
    };

    // Double rAF ≈ mounted + painted, then idle time before touching the network.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(afterPaint);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (pollId) clearTimeout(pollId);
      if (timeoutId) clearTimeout(timeoutId);
      if (
        idleId !== undefined &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next || dismissedRef.current) return;
      dismissedRef.current = true;

      const ids = alerts.map((a) => a.id);
      if (ids.length === 0) return;
      // Optimistic and silent: the teacher has read the message, and a failed
      // write only means it greets them again next time. A toast about a
      // notification they just dismissed would be the noisier failure.
      void callAction(() => dismissAralAssignmentAlerts(ids)).catch(() => {});
    },
    [alerts]
  );

  if (alerts.length === 0) return null;

  const single = alerts.length === 1 ? alerts[0] : null;
  // Deep-link only when every alert points at the same roster; otherwise the
  // ARAL index, which lists them all.
  const hrefs = new Set(alerts.map((a) => a.href));
  const href = hrefs.size === 1 ? alerts[0].href : ARAL_ROSTER_HREF;

  // One heading per person, not one per alert: assigning learners one by one
  // writes one alert each, and a dozen identical headings buried the names.
  const groups = new Map<string, { count: number; names: { id: string; text: string }[] }>();
  for (const a of alerts) {
    const group = groups.get(a.actorName) ?? { count: 0, names: [] };
    group.count += a.count;
    group.names.push({ id: a.id, text: a.description });
    groups.set(a.actorName, group);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Capped to the viewport so a long list scrolls inside the dialog
          instead of pushing the buttons off screen. */}
      <DialogContent className="flex max-h-[85dvh] max-w-md flex-col">
        <DialogHeader>
          <span
            aria-hidden
            className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-aral-soft text-aral-soft-foreground"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          {single ? (
            <>
              <DialogTitle>{single.title}</DialogTitle>
              <DialogDescription>{single.description}</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>New ARAL learners</DialogTitle>
              <DialogDescription>
                You were designated an ARAL teacher while you were away.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {single ? null : (
          <div
            tabIndex={0}
            aria-label="New ARAL learners"
            className="-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ul className="space-y-4">
              {[...groups].map(([actorName, group]) => (
                <li key={actorName} className="text-sm">
                  <span className="block font-medium text-foreground">
                    {actorName} assigned you{" "}
                    {group.count === 1 ? "an ARAL learner" : `${group.count} ARAL learners`}.
                  </span>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {group.names.map((n) => (
                      <li key={n.id} className="break-words">
                        {n.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Dismiss
          </Button>
          <Button asChild onClick={() => handleOpenChange(false)}>
            <Link href={href}>Open ARAL roster</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
