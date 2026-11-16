"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const ADS = [
  { id: "juans-year", title: "Juan's Year" },
  { id: "one-school-day", title: "One School Day" },
  { id: "four-desks", title: "Four Desks" },
] as const;

/** Desktop only: the corner card would cover the sign-in form on a phone. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** How long the page must sit untouched before the card appears. */
const QUIET_MS = 4000;
const DISMISS_KEY = "litrack:login-ads-dismissed";

type Connection = { saveData?: boolean };

/**
 * Removing a <video> element alone can leave its download open; clearing the
 * source first makes the browser drop the connection.
 */
function stopVideo(v: HTMLVideoElement | null) {
  if (!v) return;
  v.pause();
  v.removeAttribute("src");
  v.load();
}

function shouldSkip(): boolean {
  if (typeof window === "undefined") return true;
  if (!window.matchMedia(DESKTOP_QUERY).matches) return true;
  const conn = (navigator as Navigator & { connection?: Connection }).connection;
  if (conn?.saveData) return true;
  try {
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return true;
  } catch {
    // Storage blocked: show the card; dismissing it still hides it for this page.
  }
  return false;
}

/**
 * LITRACK's ad videos in the bottom-left corner of the sign-in page, desktop
 * only. Nothing about it competes with signing in:
 *
 * - It mounts last: after the window `load` event, then an idle callback,
 *   then QUIET_MS with no typing, clicking or scrolling. Any activity
 *   restarts that wait, so it never appears while someone is filling in the
 *   form.
 * - Once a sign-in form is submitted it never mounts, and a card that is
 *   already showing is removed (its video stops downloading).
 * - Videos never autoplay and use `preload="none"`: only the small poster
 *   loads until someone presses play.
 * - Skipped on phones and tablets, with Data Saver on, and after the
 *   visitor closes it (for the rest of the browser session).
 */
export function LoginAdReel() {
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (shouldSkip()) return;
    let cancelled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let idleHandle: number | undefined;
    let loaded = document.readyState === "complete";
    let submitted = false;

    const arm = () => {
      clearTimeout(quietTimer);
      if (!loaded || submitted || cancelled) return;
      quietTimer = setTimeout(() => {
        if (cancelled || submitted) return;
        if (!window.matchMedia(DESKTOP_QUERY).matches) return;
        setReady(true);
        stopListening();
      }, QUIET_MS);
    };

    const onActivity = () => arm();
    const onSubmit = () => {
      submitted = true;
      clearTimeout(quietTimer);
      stopVideo(videoRef.current);
      setSigningIn(true);
    };
    const activity = ["keydown", "pointerdown", "input", "wheel", "touchstart"] as const;

    const stopListening = () => {
      for (const type of activity) window.removeEventListener(type, onActivity, true);
    };

    const start = () => {
      loaded = true;
      const ric = window.requestIdleCallback;
      if (ric) idleHandle = ric(() => arm(), { timeout: 3000 });
      else arm();
    };

    for (const type of activity) window.addEventListener(type, onActivity, { capture: true, passive: true });
    // A sign-in submit always wins: listen for the whole page's life.
    document.addEventListener("submit", onSubmit, true);
    if (loaded) start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      cancelled = true;
      clearTimeout(quietTimer);
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
      window.removeEventListener("load", start);
      stopListening();
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  if (!ready || signingIn || dismissed) return null;

  const ad = ADS[index];

  const close = () => {
    stopVideo(videoRef.current);
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: hidden for this page only.
    }
  };

  return (
    <aside
      aria-label="About LITRACK: videos"
      className="fixed bottom-4 left-4 z-30 hidden w-80 overflow-hidden rounded-xl border border-border/60 bg-background/90 shadow-xl backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-slow lg:block xl:w-96"
    >
      <div className="flex items-center justify-between gap-2 pb-1 pl-3 pr-1 pt-1">
        <p className="text-sm font-semibold text-foreground">See LITRACK at work</p>
        <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Close videos">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <video
        key={ad.id}
        ref={videoRef}
        className="aspect-video w-full bg-black"
        src={`/ads/${ad.id}.mp4`}
        poster={`/ads/${ad.id}.webp`}
        preload="none"
        controls
        playsInline
        controlsList="nodownload"
        aria-label={`${ad.title}, LITRACK video`}
      />
      <div role="group" aria-label="Choose a video" className="flex gap-1 p-2">
        {ADS.map((a, i) => (
          <Button
            key={a.id}
            type="button"
            size="sm"
            variant={i === index ? "default" : "ghost"}
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            className="min-w-0 flex-1 px-2 text-xs"
          >
            <span className="truncate">{a.title}</span>
          </Button>
        ))}
      </div>
    </aside>
  );
}
