// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playThemeWaves, RESUME_MOTION_MS, THEME_SWITCHING_CLASS } from "@/components/theme/theme-waves";

/** A View Transition whose `finished` the test resolves by hand. */
function installViewTransitions() {
  const finishers: (() => void)[] = [];
  const skips: ReturnType<typeof vi.fn>[] = [];
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (update: () => void) => {
    update();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    finishers.push(finish);
    const skipTransition = vi.fn(() => finish());
    skips.push(skipTransition);
    return { ready: new Promise<void>(() => {}), finished, skipTransition };
  };
  return Object.assign(finishers, { skips });
}

const held = () => document.documentElement.classList.contains(THEME_SWITCHING_CLASS);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.documentElement.classList.remove(THEME_SWITCHING_CLASS);
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});

describe("playThemeWaves page motion hold", () => {
  it("holds page motion through the reveal and for 3 s after it ends", async () => {
    const finishers = installViewTransitions();
    playThemeWaves({ x: 10, y: 10 }, () => {});
    expect(held()).toBe(true);
    finishers[0]();
    await flush();
    vi.advanceTimersByTime(RESUME_MOTION_MS - 1);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(held()).toBe(false);
  });

  it("a new switch inside the 3 s keeps the page held and restarts the wait", async () => {
    const finishers = installViewTransitions();
    playThemeWaves({ x: 10, y: 10 }, () => {});
    finishers[0]();
    await flush();
    vi.advanceTimersByTime(2000);
    playThemeWaves({ x: 10, y: 10 }, () => {});
    vi.advanceTimersByTime(2000);
    expect(held()).toBe(true);
    finishers[1]();
    await flush();
    vi.advanceTimersByTime(RESUME_MOTION_MS - 1);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(held()).toBe(false);
  });

  it("a click mid-reveal ends that reveal and swaps with no second reveal", async () => {
    const finishers = installViewTransitions();
    const swap = vi.fn();
    playThemeWaves({ x: 10, y: 10 }, swap);
    playThemeWaves({ x: 10, y: 10 }, swap);
    expect(swap).toHaveBeenCalledTimes(2);
    expect(finishers).toHaveLength(1);
    expect(finishers.skips[0]).toHaveBeenCalledTimes(1);
    await flush();
    // The skipped reveal finishing does not release early; the skip's own 3 s does.
    vi.advanceTimersByTime(RESUME_MOTION_MS - 1);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(held()).toBe(false);
  });

  it("after a skip, the next click animates again", async () => {
    const finishers = installViewTransitions();
    playThemeWaves({ x: 10, y: 10 }, () => {});
    playThemeWaves({ x: 10, y: 10 }, () => {});
    await flush();
    playThemeWaves({ x: 10, y: 10 }, () => {});
    expect(finishers).toHaveLength(2);
  });
});

describe("playThemeWaves reveal animation cleanup", () => {
  it("cancels the reveal animation once its transition ends, so the next reveal is the only clip animation", async () => {
    let finish!: () => void;
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (update: () => void) => {
      update();
      return { ready: Promise.resolve(), finished: new Promise<void>((resolve) => (finish = resolve)) };
    };
    const cancel = vi.fn();
    const root = document.documentElement as HTMLElement & { animate: unknown };
    const original = root.animate;
    root.animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    try {
      // A fresh module: earlier tests leave a reveal marked as running.
      vi.resetModules();
      const fresh = await import("@/components/theme/theme-waves");
      fresh.playThemeWaves({ x: 10, y: 10 }, () => {});
      await flush();
      expect(root.animate).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
      finish();
      await flush();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      root.animate = original;
    }
  });
});
