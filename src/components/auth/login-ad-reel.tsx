"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Maximize, Minimize, Pause, Play, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The three LITRACK videos joined end to end (7:25, 720p). Served from the
 * public R2 domain rather than the Worker's static assets: R2 answers byte-range
 * requests (206), which the timeline needs to seek, and Workers Static Assets
 * does not.
 */
const MEDIA_BASE = process.env.NEXT_PUBLIC_AVATAR_BASE_URL || "https://avatars.arallitrack.com";
export const AD_VIDEO_SRC = `${MEDIA_BASE}/site/litrack-ads.mp4`;
const POSTER = `${MEDIA_BASE}/site/litrack-ads.webp`;

/** `brand`: under the title, desktop. `card`: under the sign-in card, phones and tablets. */
export type AdPlacement = "brand" | "card";
const QUERY: Record<AdPlacement, string> = {
  brand: "(min-width: 1024px)",
  card: "(max-width: 1023.98px)",
};

/** How long the page must sit untouched before the video appears. */
const QUIET_MS = 4000;
/** Space between the tagline and the video (brand placement). */
const GAP_PX = 24;
/** Below this height the brand-column video is too small to be worth showing. */
const MIN_HEIGHT_PX = 150;
/** The video never spans more than this share of the brand column. */
const MAX_WIDTH_SHARE = 0.85;
/** While playing, the controls hide after this long without the pointer moving. */
const IDLE_MS = 2500;

type Connection = { saveData?: boolean };
type Box = { width: number; height: number; offset: number };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function shouldSkip(placement: AdPlacement): boolean {
  if (typeof window === "undefined") return true;
  if (!window.matchMedia(QUERY[placement]).matches) return true;
  const conn = (navigator as Navigator & { connection?: Connection }).connection;
  return Boolean(conn?.saveData);
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

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The 16:9 box right under the tagline, no lower than the sign-in card's
 * bottom edge and no wider than MAX_WIDTH_SHARE of the brand column. Null when
 * it would be too small.
 */
function measure(anchor: HTMLElement): Box | null {
  const card = document.querySelector<HTMLElement>("[data-login-card]");
  if (!card) return null;
  const top = anchor.getBoundingClientRect().top;
  const bottom = card.getBoundingClientRect().bottom;
  const room = bottom - top - GAP_PX;
  // A little narrower than the column, so it does not crowd the card.
  const width = Math.min(anchor.clientWidth * MAX_WIDTH_SHARE, room * (16 / 9));
  const height = width * (9 / 16);
  if (height < MIN_HEIGHT_PX) return null;
  return { width, height, offset: GAP_PX };
}

/** Re-checks the placement when the window crosses the desktop breakpoint. */
function subscribeMedia(onChange: () => void) {
  const mq = window.matchMedia(QUERY.brand);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

/**
 * Whether the video may appear yet. It mounts last: after the window `load`
 * event, then an idle callback, then QUIET_MS with no typing, tapping,
 * clicking or scrolling (any of them restarts the wait), so it never appears
 * while someone is filling in the form; a placeholder holds its spot meanwhile.
 * A sign-in submit shows the player at once (poster only) and stops any download.
 */
function useDeferredReveal(placement: AdPlacement, onSubmit: () => void) {
  // `enabled`: this placement shows here at all (a placeholder holds the spot
  // until `ready`). `ready`: the player itself may mount.
  const enabled = useSyncExternalStore(
    subscribeMedia,
    () => !shouldSkip(placement),
    () => false
  );
  const [ready, setReady] = useState(false);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    if (shouldSkip(placement)) return;
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
        if (!window.matchMedia(QUERY[placement]).matches) return;
        setReady(true);
        stopListening();
      }, QUIET_MS);
    };

    const onActivity = () => arm();
    // Signing in stops any download so the sign-in request goes first, but
    // the player stays on screen (its poster) rather than leaving a hole.
    const handleSubmit = () => {
      submitted = true;
      clearTimeout(quietTimer);
      stopListening();
      onSubmitRef.current();
      if (!cancelled) setReady(true);
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
    document.addEventListener("submit", handleSubmit, true);
    if (loaded) start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      cancelled = true;
      clearTimeout(quietTimer);
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
      window.removeEventListener("load", start);
      stopListening();
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, [placement]);

  return { enabled, ready };
}

/** Holds the video's spot, same size and frame, until the player mounts. */
function VideoLoader({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      role="status"
      aria-label="Loading video"
      className={`flex items-center justify-center rounded-2xl bg-black/50 shadow-2xl ring-1 ring-white/70 backdrop-blur-md ${className}`}
      style={style}
    >
      <Loader2 className="size-8 animate-spin text-white/90" aria-hidden />
    </div>
  );
}

/**
 * LITRACK's video on the sign-in page, as an ordinary embedded player: play
 * button in the middle, then a control bar with a timeline, volume (click the
 * speaker to mute) and full screen, plus a close button. Controls show while
 * paused, while the pointer is over the video, or for a moment after a tap.
 *
 * Desktop shows it right under the tagline (`brand`); phones and tablets show
 * it under the legal line below the sign-in card (`card`). It never autoplays
 * and uses `preload="none"`: only the poster loads until someone presses play.
 * Closing it hides it until the page is loaded again. Skipped with Data Saver on.
 */
export function LoginAdReel({ placement }: { placement: AdPlacement }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { enabled, ready } = useDeferredReveal(placement, () => stopVideo(videoRef.current));
  const [closed, setClosed] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Brand placement: keep the box fitted as the window or the sign-in card
  // changes size (a message appears, the School Head tab opens).
  useLayoutEffect(() => {
    if (!enabled || placement !== "brand") return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const next = window.matchMedia(QUERY.brand).matches ? measure(anchor) : null;
      setBox((prev) =>
        prev && next && Math.abs(prev.height - next.height) < 1 && Math.abs(prev.offset - next.offset) < 1
          ? prev
          : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    const card = document.querySelector("[data-login-card]");
    if (card) observer.observe(card);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, placement]);

  if (!enabled || closed) return null;

  const close = () => {
    stopVideo(videoRef.current);
    setClosed(true);
  };

  if (placement === "card") {
    return (
      <div className="mt-6 lg:hidden">
        {ready ? (
          <Player videoRef={videoRef} onClose={close} className="aspect-video w-full" />
        ) : (
          <VideoLoader className="aspect-video w-full" />
        )}
      </div>
    );
  }

  const boxStyle = box ? { width: box.width, height: box.height, marginTop: box.offset } : undefined;
  return (
    <div ref={anchorRef} className="hidden w-full lg:block">
      {box ? (
        ready ? (
          <Player videoRef={videoRef} onClose={close} style={boxStyle} />
        ) : (
          <VideoLoader style={boxStyle} />
        )
      ) : null}
    </div>
  );
}

function Player({
  videoRef,
  onClose,
  className = "",
  style,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const frameRef = useRef<HTMLElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastPointer = useRef<string>("mouse");
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const wake = useCallback(() => {
    setActive(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      clearTimeout(idleTimer.current);
    };
  }, []);

  const showChrome = !playing || active;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };

  // A tap on a touch screen first reveals the controls; only a tap while they
  // show plays or pauses, the way phone video players behave.
  const onSurface = () => {
    if (lastPointer.current === "touch" && !showChrome) {
      wake();
      return;
    }
    togglePlay();
    wake();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    // Unmuting at zero volume would stay silent: bring it back to half.
    if (v.muted || v.volume === 0) {
      if (v.volume === 0) v.volume = 0.5;
      v.muted = false;
    } else {
      v.muted = true;
    }
  };

  const changeVolume = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
  };

  const seek = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = value;
    setTime(value);
  };

  // The frame goes full screen, not the <video>, so these controls keep
  // working there. iOS Safari can only make the video itself full screen.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    const frame = frameRef.current;
    if (frame && typeof frame.requestFullscreen === "function") {
      void frame.requestFullscreen().catch(() => {});
      return;
    }
    (videoRef.current as IosVideo | null)?.webkitEnterFullscreen?.();
  };

  const silent = muted || volume === 0;
  const VolumeIcon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const fade = `transition-opacity duration-base ${showChrome ? "opacity-100" : "pointer-events-none opacity-0"}`;
  const iconButton = "size-9 shrink-0 rounded-full text-white hover:bg-black/40 hover:text-white lg:size-9";

  return (
    <figure
      ref={frameRef}
      aria-label="LITRACK at work, video"
      className={`group relative isolate m-0 overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/70 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-slow [&:fullscreen]:!m-0 [&:fullscreen]:!h-screen [&:fullscreen]:!w-screen [&:fullscreen]:rounded-none [&:fullscreen]:ring-0 ${className}`}
      style={style}
      onPointerEnter={(e) => {
        lastPointer.current = e.pointerType;
        if (e.pointerType === "mouse") wake();
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") wake();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          clearTimeout(idleTimer.current);
          setActive(false);
        }
      }}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
      }}
      onFocus={wake}
    >
      <video
        ref={videoRef}
        className={`h-full w-full ${fullscreen ? "object-contain" : "object-cover"}`}
        src={AD_VIDEO_SRC}
        poster={POSTER}
        preload="none"
        loop
        playsInline
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
      />

      {/* The whole picture is the play/pause target; the round button in the
          middle is what it looks like. */}
      <Button
        type="button"
        variant="ghost"
        onClick={onSurface}
        aria-label={playing ? "Pause video" : "Play video"}
        aria-pressed={playing}
        className="absolute inset-0 z-0 h-full w-full rounded-none p-0 hover:bg-transparent focus-visible:ring-inset lg:h-full"
      >
        <span
          className={`flex size-14 items-center justify-center rounded-full bg-background/90 text-foreground shadow-xl ring-4 ring-white/30 transition duration-base group-hover:scale-105 sm:size-16 ${
            showChrome ? "opacity-100" : "opacity-0"
          }`}
        >
          {playing ? (
            <Pause className="size-6 fill-current sm:size-7" aria-hidden />
          ) : (
            <Play className="ml-1 size-6 fill-current sm:size-7" aria-hidden />
          )}
        </span>
      </Button>

      {/* Top: a title before the first play, and the close button. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-2 pl-3 ${fade}`}
      >
        <p className={`pt-1.5 text-xs font-semibold text-white drop-shadow sm:text-sm ${started ? "invisible" : ""}`}>
          LITRACK in action · {duration ? clock(duration) : "7:25"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close video"
          className={`pointer-events-auto ${iconButton}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {/* Bottom: the control bar. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pb-1.5 pt-8 ${fade}`}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.currentTarget.value))}
          aria-label="Seek"
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          className="mx-1 block h-1 w-[calc(100%-0.5rem)] cursor-pointer accent-white"
          disabled={!duration}
        />
        <div className="mt-1 flex items-center gap-1 text-white">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className={iconButton}
          >
            {playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            aria-label={silent ? "Unmute" : "Mute"}
            aria-pressed={silent}
            className={iconButton}
          >
            <VolumeIcon className="size-4" aria-hidden />
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={silent ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.currentTarget.value))}
            aria-label="Volume"
            className="hidden h-1 w-16 cursor-pointer accent-white sm:block lg:w-20"
          />
          <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-white/90">
            {clock(time)} / {clock(duration)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            className={`ml-auto ${iconButton}`}
          >
            {fullscreen ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          </Button>
        </div>
      </div>
    </figure>
  );
}
