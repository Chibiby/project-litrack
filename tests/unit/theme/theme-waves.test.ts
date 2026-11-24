// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playThemeWaves, RESUME_MOTION_MS, THEME_SWITCHING_CLASS } from "@/components/theme/theme-waves";

/** A View Transition whose `finished` the test resolves by hand. */
function installViewTransitions() {
  const finishers: (() => void)[] = [];
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (update: () => void) => {
    update();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    finishers.push(finish);
    return { ready: new Promise<void>(() => {}), finished };
  };
  return finishers;
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

  it("an older reveal ending never releases a newer one", async () => {
    const finishers = installViewTransitions();
    playThemeWaves({ x: 10, y: 10 }, () => {});
    playThemeWaves({ x: 10, y: 10 }, () => {});
    finishers[0]();
    await flush();
    vi.advanceTimersByTime(RESUME_MOTION_MS * 2);
    expect(held()).toBe(true);
  });
});
