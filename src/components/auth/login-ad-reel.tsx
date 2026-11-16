"use client";

import { useEffect, useRef, useState } from "react";

/** One file: the three LITRACK videos joined end to end. */
const SRC = "/ads/litrack-ads.mp4";
const POSTER = "/ads/litrack-ads.webp";

/** Desktop only: on a phone the video would push the sign-in form down. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** How long the page must sit untouched before the video appears. */
const QUIET_MS = 4000;

type Connection = { saveData?: boolean };

function shouldSkip(): boolean {
  if (typeof window === "undefined") return true;
  if (!window.matchMedia(DESKTOP_QUERY).matches) return true;
  const conn = (navigator as Navigator & { connection?: Connection }).connection;
  return conn?.saveData === true;
}

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

/**
 * LITRACK's videos under the title and tagline on the sign-in page, desktop
 * only, as one looping video. Nothing about it competes with signing in:
 *
 * - It mounts last: after the window `load` event, then an idle callback,
 *   then QUIET_MS with no typing, clicking or scrolling. Any activity
 *   restarts that wait, so it never appears while someone is filling in the
 *   form.
 * - Once a sign-in form is submitted it never mounts, and a video that is
 *   already showing is removed (its download stops).
 * - It never autoplays and uses `preload="none"`: only the poster loads until
 *   someone presses play. Then it loops.
 * - Skipped on phones and tablets, and with Data Saver on.
 */
export function LoginAdReel() {
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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

  if (!ready || signingIn) return null;

  return (
    <video
      ref={videoRef}
      className="mt-8 hidden aspect-video w-full max-w-xl overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-border/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-slow lg:block xl:max-w-2xl"
      src={SRC}
      poster={POSTER}
      preload="none"
      controls
      loop
      playsInline
      controlsList="nodownload"
      aria-label="LITRACK at work, video"
    />
  );
}
