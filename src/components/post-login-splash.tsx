"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  POST_LOGIN_FLAG,
  clearPendingPostLoginSplash,
  consumePostLoginFlag,
} from "@/lib/post-login-flag";
import styles from "./post-login-splash.module.css";

export { POST_LOGIN_FLAG };

const MIN_MS = 2500;
const HARD_CAP_MS = 8000;
const BOOK_START_DELAY_MS = 250;
const BOOK_STEP_MS = 850;
const FAST_FORWARD_STEP_MS = 90;
const REVEAL_HOLD_MS = 900;
const FADE_OUT_MS = 500;

/** Match nav-prefetcher: bound FULL RSC fan-out so Prisma pool stays healthy. */
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_GAP_MS = 120;

/** Next App Router PrefetchKind.FULL — same pattern as nav-prefetcher. */
const PREFETCH_FULL = { kind: "full" } as NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;

export type PostLoginSplashRole = "teacher" | "school-head" | "admin";

const ROLE_PREFETCH: Record<PostLoginSplashRole, readonly string[]> = {
  teacher: [
    "/teacher/learners",
    "/teacher/aral",
    "/teacher/reports",
    "/teacher/settings",
  ],
  "school-head": [
    "/school-head/teachers",
    "/school-head/reports",
    "/school-head/grade-levels",
    "/school-head/settings",
  ],
  admin: ["/admin/schools", "/admin/transfers", "/admin/settings"],
};

const WARM_IMAGES = ["/logo.png", "/aral-na-logo.png", "/partner-logos.png"] as const;

const PHRASES = [
  "Sharpening pencils",
  "Waking up the alphabet",
  "Fluffing the reading corner",
  "Counting gold stars",
  "Almost ready",
] as const;

const BOOK_COUNT = PHRASES.length;

export type PostLoginSplashProps = {
  /** When set, FULL-prefetches that role's key routes while the splash shows. */
  role?: PostLoginSplashRole;
};

export function getPostLoginPrefetchHrefs(
  role: PostLoginSplashRole
): readonly string[] {
  return ROLE_PREFETCH[role];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function warmImages(srcs: readonly string[]): void {
  for (const src of srcs) {
    try {
      const img = new window.Image();
      img.src = src;
    } catch {
      // Best-effort; never surface into the UI.
    }
  }
}

function firePrefetches(
  router: ReturnType<typeof useRouter>,
  hrefs: readonly string[]
): void {
  if (hrefs.length === 0) return;

  void (async () => {
    let cursor = 0;

    const worker = async () => {
      while (cursor < hrefs.length) {
        const href = hrefs[cursor++];
        try {
          router.prefetch(href, PREFETCH_FULL);
        } catch {
          // Prefetch is best-effort; never surface into the UI.
        }
        if (cursor < hrefs.length) {
          await sleep(PREFETCH_GAP_MS);
        }
      }
    };

    const workers = Math.min(PREFETCH_CONCURRENCY, hrefs.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  })();
}

/**
 * Full-screen post-login splash. Shows only when `litrack:post-login` is set
 * (read-and-cleared on mount). Portaled to document.body at z-9999 so RoleShell
 * chrome cannot contain/clip it; app hydrates underneath. Dismisses after min
 * 2.5s once ready (hard cap 8s).
 */
export function PostLoginSplash({ role }: PostLoginSplashProps) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [phrase, setPhrase] = useState<string>(PHRASES[0]);
  /** null = let CSS fade-up control opacity; number = JS caption crossfade. */
  const [phraseOpacity, setPhraseOpacity] = useState<number | null>(null);
  const [stageDone, setStageDone] = useState(false);
  const [shelfDone, setShelfDone] = useState(false);
  const [labelDone, setLabelDone] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  const filledCountRef = useRef(0);
  const finishingRef = useRef(false);
  const readyRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    filledCountRef.current = filledCount;
  }, [filledCount]);

  // Read-and-clear the post-login flag; absent → never show.
  useEffect(() => {
    if (!consumePostLoginFlag()) return;
    startedAtRef.current = Date.now();
    setActive(true);
  }, []);

  // Hydrated + prefetches fired → ready. Combined with MIN_MS before dismiss.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let raf1 = 0;
    let raf2 = 0;

    const markReady = () => {
      if (cancelled || readyRef.current) return;
      if (role) {
        firePrefetches(router, ROLE_PREFETCH[role]);
      }
      warmImages(WARM_IMAGES);
      readyRef.current = true;
    };

    const afterPaint = () => {
      if (cancelled) return;
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(markReady, { timeout: 1500 });
      } else {
        timeoutId = setTimeout(markReady, 200);
      }
    };

    // Double rAF ≈ mounted + painted, then idle/timeout before firing prefetches.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(afterPaint);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (
        idleId !== undefined &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [active, role, router]);

  // Scheduled book fill while waiting (cancelled once finish starts).
  useEffect(() => {
    if (!active) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < BOOK_COUNT; i++) {
      timers.push(
        setTimeout(() => {
          if (finishingRef.current) return;
          const next = i + 1;
          setFilledCount((prev) => Math.max(prev, next));
          setPhraseOpacity(0);
          setTimeout(() => {
            if (finishingRef.current) return;
            setPhrase(PHRASES[i]);
            setPhraseOpacity(1);
          }, 150);
        }, BOOK_START_DELAY_MS + i * BOOK_STEP_MS)
      );
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [active]);

  // Dismiss when ready after min, or at hard cap.
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const runFinish = async () => {
      if (cancelled || finishingRef.current) return;
      finishingRef.current = true;

      const reduced = prefersReducedMotion();
      const ffStep = reduced ? 0 : FAST_FORWARD_STEP_MS;
      const revealHold = reduced ? 80 : REVEAL_HOLD_MS;
      const fadeMs = reduced ? 0 : FADE_OUT_MS;

      try {
        // Fast-forward any remaining books, then ARAL reveal.
        let current = filledCountRef.current;
        while (current < BOOK_COUNT) {
          if (cancelled) return;
          current += 1;
          setFilledCount(current);
          setPhraseOpacity(0);
          await sleep(reduced ? 0 : 80);
          if (cancelled) return;
          setPhrase(PHRASES[current - 1]);
          setPhraseOpacity(1);
          await sleep(ffStep);
        }

        if (cancelled) return;
        setLabelDone(true);
        setShelfDone(true);
        setStageDone(true);

        await sleep(revealHold);
        if (cancelled) return;

        setFadingOut(true);
        await sleep(fadeMs);
        if (cancelled) return;

        clearPendingPostLoginSplash();
        setActive(false);
      } finally {
        // Effect cleanup (Strict Mode) may abort mid-finish — allow a retry.
        if (cancelled) finishingRef.current = false;
      }
    };

    const maybeFinish = () => {
      if (finishingRef.current || cancelled) return;
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed >= HARD_CAP_MS || (readyRef.current && elapsed >= MIN_MS)) {
        void runFinish();
      }
    };

    const pollId = window.setInterval(maybeFinish, 50);
    const capId = window.setTimeout(() => {
      void runFinish();
    }, HARD_CAP_MS);

    maybeFinish();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearTimeout(capId);
    };
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  // Portal + fixed overlay: never mount inside RoleShell stacking/overflow.
  // Inline critical cover styles so a missing CSS-module chunk cannot leak
  // splash content into the page layout (sidebar/top bar staying visible).
  const overlay = (
    <div
      className={`${styles.overlay}${fadingOut ? ` ${styles.overlayFading}` : ""}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        width: "100vw",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#fdfbf5",
        opacity: fadingOut ? 0 : 1,
        pointerEvents: fadingOut ? "none" : "auto",
        transition: fadingOut ? "opacity 0.5s ease" : undefined,
      }}
      role="status"
      aria-live="polite"
      aria-busy={!stageDone}
      aria-label="Loading LITRACK"
      data-post-login-splash=""
    >
      <div className={`${styles.corner} ${styles.cornerTl}`} aria-hidden />
      <div className={`${styles.corner} ${styles.cornerBr}`} aria-hidden />

      <div
        className={`${styles.stage}${stageDone ? ` ${styles.stageDone}` : ""}`}
      >
        <Image
          className={styles.programLogo}
          src="/logo.png"
          alt="ARAL Program logo"
          width={300}
          height={400}
          sizes="min(48vw, 300px)"
          priority
        />
        <Image
          className={styles.aralLogo}
          src="/aral-na-logo.png"
          alt="ARAL na! logo"
          width={704}
          height={216}
          sizes="(max-width: 640px) 78vw, 460px"
          priority
        />
      </div>

      <div
        className={`${styles.shelfWrap}${shelfDone ? ` ${styles.shelfDone}` : ""}`}
        aria-hidden
      >
        <div className={styles.shelf}>
          {Array.from({ length: BOOK_COUNT }, (_, i) => (
            <div
              key={i}
              className={`${styles.book}${
                i < filledCount ? ` ${styles.bookFilled}` : ""
              }`}
            />
          ))}
        </div>
      </div>

      <div
        className={`${styles.statusLabel}${
          labelDone ? ` ${styles.statusLabelDone}` : ""
        }`}
        style={
          labelDone || phraseOpacity === null
            ? undefined
            : { opacity: phraseOpacity, transition: "opacity 0.25s ease" }
        }
      >
        {phrase}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

export default PostLoginSplash;
