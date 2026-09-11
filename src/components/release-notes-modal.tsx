"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeRelease, announceRelease } from "@/lib/actions/release";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";
import { latestRelease } from "@/lib/releases";

/**
 * Fired on `window` once a release is acknowledged, so the bell can show the row
 * `announceRelease` wrote while the modal was open. The bell fetched on mount,
 * before that row existed; without this it would stay empty until the next full
 * load — exactly when someone reaches for it to find what they just dismissed.
 */
export const RELEASE_ACKNOWLEDGED_EVENT = "litrack:release-acknowledged";

/** How often to re-check whether the login splash still covers the screen. */
const COVER_POLL_MS = 250;
/**
 * Stop waiting for the splash regardless. Its own hard cap is 8s; if the cover
 * never lifts, a late modal still beats none. Same numbers as the ARAL alerts.
 */
const COVER_WAIT_CAP_MS = 10_000;

/**
 * "Here is what changed", shown once per release per user.
 *
 * Takes `lastSeenVersion` as a prop rather than reading it: the layout already
 * holds the user row, and a second round trip on every entry to re-answer a
 * question the server just answered would be waste on the common path — where
 * the answer is "nothing to show".
 *
 * A string equality test, not a `compareVersions` call. Anything other than the
 * exact current version means "has not acknowledged THIS release", which is true
 * both for someone older and for someone who was served a newer build that was
 * then rolled back. Ordering is not the question being asked.
 *
 * Waits out the post-login splash before opening, via the same shared flag the
 * ARAL alerts use: the splash owns the screen at z-9999, and a dialog opened
 * beneath it would trap focus behind a cover nobody can see past.
 *
 * Every way of closing it is the acknowledgement — "Got it", ✕, Escape, the
 * overlay — following the ARAL alerts dialog. There is no way to see the notes
 * and still be shown them again. The dialog stays open until the stamp is saved,
 * and says so if it cannot be.
 */
export function ReleaseNotesModal({
  lastSeenVersion,
}: {
  lastSeenVersion: string | null;
}) {
  const release = latestRelease();
  const unseen = release.announce && lastSeenVersion !== release.version;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: React mounts effects twice in development, and this is
  // what keeps that from writing two bell rows.
  const announced = useRef(false);

  useEffect(() => {
    if (!unseen) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + COVER_WAIT_CAP_MS;

    const whenUncovered = () => {
      if (cancelled) return;
      if (isPostLoginLoadingCover() && Date.now() < deadline) {
        pollId = setTimeout(whenUncovered, COVER_POLL_MS);
        return;
      }
      setOpen(true);
      if (!announced.current) {
        announced.current = true;
        // Not awaited: the modal is on screen, and the bell row is a durable
        // record for later, not a precondition for reading this.
        void announceRelease();
      }
    };

    whenUncovered();
    return () => {
      cancelled = true;
      if (pollId) clearTimeout(pollId);
    };
  }, [unseen]);

  if (!unseen) return null;

  const acknowledge = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await acknowledgeRelease();
    setSaving(false);
    if (!res.ok) {
      // Closing on failure would show this again on the next page with no
      // explanation. Staying open lets them retry.
      setError(res.error);
      return;
    }
    setOpen(false);
    window.dispatchEvent(new Event(RELEASE_ACKNOWLEDGED_EVENT));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void acknowledge();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{release.title}</DialogTitle>
          <DialogDescription>
            What&apos;s new in LITRACK {release.version} · {release.date}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          {release.fixes.map((fix) => (
            <li key={fix} className="flex gap-2">
              <span aria-hidden="true" className="text-primary">
                &bull;
              </span>
              <span>{fix}</span>
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {/* 44px below `sm` comes from the Button primitive (3b62b17). */}
          <Button onClick={() => void acknowledge()} loading={saving} loadingText="Saving…">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
