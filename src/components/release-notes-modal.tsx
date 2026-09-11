"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeRelease } from "@/lib/actions/release";
import { isPostLoginLoadingCover } from "@/lib/post-login-flag";
import { APP_VERSION, latestRelease, unseenReleases } from "@/lib/releases";

/** How often to re-check whether the login splash still covers the screen. */
const COVER_POLL_MS = 250;
/**
 * Stop waiting for the splash regardless. Its own hard cap is 8s; if the cover
 * never lifts, a late modal still beats none. Same numbers as the ARAL alerts.
 */
const COVER_WAIT_CAP_MS = 10_000;

/**
 * "LITRACK System updated to vX.Y.Z", shown once per release per user, listing
 * every version they have not seen yet (`unseenReleases`) with its changes.
 * The bell keeps the history afterwards; this dialog is read once.
 *
 * Takes `lastSeenVersion` as a prop rather than reading it: the layout already
 * holds the user row, and a second round trip on every entry to re-answer a
 * question the server just answered would be waste on the common path — where
 * the answer is "nothing to show".
 *
 * Whether to open is a string equality test, not a `compareVersions` call.
 * Anything other than the exact current version means "has not acknowledged
 * THIS release", which is true both for someone older and for someone who was
 * served a newer build that was then rolled back.
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
  const releases = unseenReleases(lastSeenVersion);
  const unseen = releases.length > 0;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <DialogTitle>LITRACK System updated to v{APP_VERSION}</DialogTitle>
          <DialogDescription>
            {release.title} · {release.date}
          </DialogDescription>
        </DialogHeader>

        {/* One section per unseen version. Several can ship between two
            sign-ins, so the list scrolls rather than growing past the screen. */}
        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {releases.map((r) => (
            <section key={r.version} aria-label={`Version ${r.version}`}>
              <p className="text-sm font-medium text-foreground">
                v{r.version}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {r.date} · {r.title}
                </span>
              </p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {r.fixes.map((fix) => (
                  <li key={fix} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary">
                      &bull;
                    </span>
                    <span>{fix}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

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
