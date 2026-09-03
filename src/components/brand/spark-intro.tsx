"use client";

import { useEffect } from "react";
import {
  SPARK_INTRO_COVER_ATTR,
  SPARK_INTRO_WINDOW_KEY,
  SPARK_PRELOADER_SRC,
} from "@/lib/brand/spark-intro";

type SparkPreloaderApi = {
  play: (opts?: { onDone?: () => void }) => Promise<void>;
  done: Promise<void> | null;
};

declare global {
  interface Window {
    SparkPreloader?: SparkPreloaderApi;
    [SPARK_INTRO_WINDOW_KEY]?: "pending" | "played";
  }
}

function removeCover(): void {
  document
    .querySelectorAll(`[${SPARK_INTRO_COVER_ATTR}]`)
    .forEach((node) => node.remove());
}

/**
 * Plays the Apache Spark brand animation on the first load of the site.
 *
 * The decision was already made in `SparkIntroScript` before first paint —
 * this only acts on it. That split matters: the cover has to exist during head
 * parse, but the 13 KB animation is not worth blocking the login form on, so
 * it loads normally and slides in under the cover it inherits.
 *
 * `spark-preloader.js` ships from the brand kit and is loaded verbatim (only
 * its two font stacks are wired to the app's `next/font` variables). It is
 * dependency-free, appends its own fixed overlay, locks scroll, re-measures on
 * resize, honours `prefers-reduced-motion` and guards against a backgrounded
 * tab, so there is nothing here to re-implement. `data-auto="off"` keeps its
 * built-in autoplay out of the way — the once-per-tab gate is ours.
 *
 * Every exit path clears the cover, including a script that never loads: the
 * one unacceptable outcome is a visitor left staring at a blank paper field.
 */
export function SparkIntro() {
  useEffect(() => {
    if (window[SPARK_INTRO_WINDOW_KEY] !== "pending") return;
    window[SPARK_INTRO_WINDOW_KEY] = "played";

    let cancelled = false;

    const play = () => {
      const api = window.SparkPreloader;
      if (cancelled || !api) {
        removeCover();
        return;
      }
      // The preloader's own overlay is above the cover, so dropping the cover
      // now is invisible — and it must go before the reveal, or it would be
      // the thing left covering the page.
      void api.play({ onDone: removeCover });
      removeCover();
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SPARK_PRELOADER_SRC}"]`
    );
    if (existing) {
      if (window.SparkPreloader) play();
      else existing.addEventListener("load", play, { once: true });
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = SPARK_PRELOADER_SRC;
    script.async = true;
    script.dataset.auto = "off";
    script.addEventListener("load", play, { once: true });
    script.addEventListener("error", removeCover, { once: true });
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

export default SparkIntro;
