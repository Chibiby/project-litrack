"use client";

import { useCallback, useEffect, useState } from "react";
import { dismissReleaseAlert, fetchReleaseAlert } from "@/lib/actions/release";
import { RELEASE_ACKNOWLEDGED_EVENT } from "@/components/release-notes-modal";
import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * The bell's release row: "what was that thing I dismissed" (§2).
 *
 * Fetched from the client after the shell has painted, never passed down from a
 * layout — the teacher layout is held to the two reads its chrome needs, and a
 * bell badge is precisely the trade it refuses. The shell stays mounted across
 * in-app navigation, so this runs once per entry, not once per page.
 *
 * Re-fetched when the modal reports an acknowledgement: the row is written while
 * the modal is open, after this first ran, and someone who has just pressed
 * "Got it" is the likeliest person to reach for the bell to find it again.
 *
 * `enabled` is off for a Super Admin, who holds no school and so can never have a
 * row — and off by default, so the bell's other callers pay nothing for it.
 */
export function useReleaseAlert(enabled: boolean) {
  const [alert, setAlert] = useState<ShellNotification | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = () => {
      fetchReleaseAlert()
        .then((next) => {
          if (!cancelled) setAlert(next);
        })
        // The action already degrades to null; this only guards the transport.
        .catch(() => {});
    };

    load();
    window.addEventListener(RELEASE_ACKNOWLEDGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(RELEASE_ACKNOWLEDGED_EVENT, load);
    };
  }, [enabled]);

  /**
   * Opening the row is reading it. Optimistic and silent, like the ARAL alerts:
   * a failed write only means the row greets them again next time, and a toast
   * about a notification they just opened would be the noisier failure.
   */
  const dismiss = useCallback((id: string) => {
    setAlert(null);
    void dismissReleaseAlert(id).catch(() => {});
  }, []);

  return { alert, dismiss };
}
