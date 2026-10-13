/**
 * The Apspark intro counts as seen only once it has played to the end.
 *
 * Regression: the head script used to mark the intro as seen the moment it
 * claimed it. `/` then redirected to `/login` with a full page load, which
 * destroyed the overlay about a second in — and `/login` skipped the intro
 * because the tab was already marked. Visitors who typed the bare domain saw
 * the animation cut short. A claim that never finishes must play again on the
 * next entry page; only a finished play may set the once-per-tab flag.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import { SparkIntro } from "@/components/brand/spark-intro";
import { SparkIntroScript } from "@/components/brand/spark-intro-script";
import {
  SPARK_INTRO_COVER_ATTR,
  SPARK_INTRO_FLAG,
  SPARK_INTRO_PATHS,
  SPARK_INTRO_WINDOW_KEY,
  SPARK_PRELOADER_SRC,
} from "@/lib/brand/spark-intro";

function runHeadScript(path: string): void {
  window.history.replaceState({}, "", path);
  const html = renderToStaticMarkup(<SparkIntroScript />);
  const js = html.replace(/^<script>/, "").replace(/<\/script>$/, "");
  new Function(js)();
}

function resetIntroState(): void {
  sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>)[SPARK_INTRO_WINDOW_KEY];
  delete window.ApsparkPreloader;
  document
    .querySelectorAll(`[${SPARK_INTRO_COVER_ATTR}], script[src]`)
    .forEach((node) => node.remove());
}

afterEach(() => {
  cleanup();
  resetIntroState();
});

describe("Apspark intro — once per tab, counted on completion", () => {
  it("claims the intro on /login without marking the tab as seen", () => {
    resetIntroState();
    runHeadScript("/login");

    expect(window[SPARK_INTRO_WINDOW_KEY]).toBe("pending");
    expect(document.querySelector(`[${SPARK_INTRO_COVER_ATTR}]`)).not.toBeNull();
    // An unload before the end (a redirect, a reload) must leave it replayable.
    expect(sessionStorage.getItem(SPARK_INTRO_FLAG)).toBeNull();
  });

  it("claims it again after an interrupted play", () => {
    resetIntroState();
    runHeadScript("/login");
    // The page goes away mid-animation: a new document starts with a fresh
    // window, but the same sessionStorage.
    delete (window as unknown as Record<string, unknown>)[SPARK_INTRO_WINDOW_KEY];
    document
      .querySelectorAll(`[${SPARK_INTRO_COVER_ATTR}]`)
      .forEach((node) => node.remove());

    runHeadScript("/login");
    expect(window[SPARK_INTRO_WINDOW_KEY]).toBe("pending");
  });

  it("does not claim it on / — that path only redirects to /login", () => {
    expect(SPARK_INTRO_PATHS).not.toContain("/");
    resetIntroState();
    runHeadScript("/");
    expect(window[SPARK_INTRO_WINDOW_KEY]).toBeUndefined();
  });

  it("marks the tab as seen only when the animation finishes", () => {
    resetIntroState();
    runHeadScript("/login");

    let finish: (() => void) | undefined;
    window.ApsparkPreloader = {
      play: vi.fn((opts?: { onDone?: () => void }) => {
        finish = opts?.onDone;
        return new Promise<void>(() => {});
      }),
      done: null,
    };
    const script = document.createElement("script");
    script.src = SPARK_PRELOADER_SRC;
    document.body.appendChild(script);

    render(<SparkIntro />);
    expect(window.ApsparkPreloader.play).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(SPARK_INTRO_FLAG)).toBeNull();

    finish?.();
    expect(sessionStorage.getItem(SPARK_INTRO_FLAG)).toBe("1");

    // Seen: the next entry page in this tab does not claim it again.
    delete (window as unknown as Record<string, unknown>)[SPARK_INTRO_WINDOW_KEY];
    runHeadScript("/login");
    expect(window[SPARK_INTRO_WINDOW_KEY]).toBeUndefined();
  });
});
