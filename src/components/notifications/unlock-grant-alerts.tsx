"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LockOpen } from "lucide-react";
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
  dismissUnlockAlerts,
  fetchUnlockAlerts,
} from "@/lib/actions/notifications";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";

/** Shape comes from the action, so this cannot drift from what the server sends. */
type Alert = Awaited<ReturnType<typeof fetchUnlockAlerts>>[number];

const ARAL_ROSTER_HREF = "/teacher/aral";

/** How often to re-check whether the login splash still covers the screen. */
const COVER_POLL_MS = 250;
/**
 * Stop waiting for the splash regardless. Its own hard cap is 8s; if something
 * has gone wrong and the cover never lifts, a late alert still beats none.
 */
const COVER_WAIT_CAP_MS = 10_000;

/** How often to re-check whether another dialog still owns the screen. */
const DIALOG_POLL_MS = 200;
/**
 * Stop deferring to another dialog regardless. `AralAssignmentAlerts` mounts
 * beside this one and can also want to open on the same login; two stacked
 * Radix dialogs trap focus behind a second overlay, so this modal waits its
 * turn. But a stuck dialog elsewhere must never mean this alert is silently
 * lost forever — a late alert still beats none, same reasoning as the splash
 * wait above.
 */
const DIALOG_WAIT_CAP_MS = 15_000;

/** True while some other Radix dialog is open, so this modal knows to wait. */
function anotherDialogIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

/**
 * Tells a teacher, on their next screen, that a Super Admin reopened a
 * submission window that covers them.
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
export function UnlockGrantAlerts() {
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
    let dialogPollId: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + COVER_WAIT_CAP_MS;
    const dialogDeadline = Date.now() + DIALOG_WAIT_CAP_MS;

    // `AralAssignmentAlerts` (or any other dialog) can already be open — or
    // still be racing to open — on the same login. Radix traps focus in its
    // topmost dialog, so a second dialog opened underneath is unreachable —
    // defer until the screen is clear rather than stacking. This runs AFTER
    // the fetch resolves and right before `setOpen(true)`, not before it: a
    // sibling alert that is still awaiting its own fetch has no dialog in the
    // DOM yet, so checking any earlier would pass right through it. Bounded
    // and cleared on unmount, same as the splash wait below, so a dialog that
    // never closes cannot spin this forever.
    const whenNotStacked = (onReady: () => void) => {
      if (cancelled) return;
      if (anotherDialogIsOpen() && Date.now() < dialogDeadline) {
        dialogPollId = setTimeout(() => whenNotStacked(onReady), DIALOG_POLL_MS);
        return;
      }
      onReady();
    };

    const load = async () => {
      if (cancelled) return;
      const rows = await fetchUnlockAlerts();
      if (cancelled || rows.length === 0) return;
      setAlerts(rows);
      whenNotStacked(() => {
        if (cancelled) return;
        setOpen(true);
      });
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
      if (dialogPollId) clearTimeout(dialogPollId);
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
      void dismissUnlockAlerts(ids).catch(() => {});
    },
    [alerts]
  );

  if (alerts.length === 0) return null;

  const single = alerts.length === 1 ? alerts[0] : null;
  // Deep-link only when every alert points at the same window; otherwise the
  // ARAL hub, which lists them all.
  const hrefs = new Set(alerts.map((a) => a.href));
  const href = hrefs.size === 1 ? alerts[0].href : ARAL_ROSTER_HREF;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span
            aria-hidden
            className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-soft text-violet-soft-foreground"
          >
            <LockOpen className="h-4 w-4" />
          </span>
          {single ? (
            <>
              <DialogTitle>{single.title}</DialogTitle>
              <DialogDescription>{single.description}</DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>Submission windows reopened</DialogTitle>
              <DialogDescription>
                Your division admin reopened these while you were away.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {single ? null : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="block font-medium text-foreground">
                  {a.title}
                </span>
                <span className="block text-muted-foreground">
                  {a.description}
                </span>
              </li>
            ))}
          </ul>
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
            <Link href={href}>Open ARAL</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
