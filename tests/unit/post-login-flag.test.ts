/**
 * The module reads `window` and `sessionStorage`, so this file opts into a DOM.
 * `vitest.config.ts` only maps `tests/components/**` to jsdom by default, and
 * on the node environment every guard here short-circuits to false.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The module holds per-document state, so each case re-imports it through
 * `vi.resetModules()`. A fresh import is exactly what a fresh document load
 * gives the browser, which is the behaviour under test.
 */
async function freshModule() {
  vi.resetModules();
  return import("@/lib/post-login-flag");
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("post-login flag — boot latch", () => {
  it("claims the splash on a fresh document with no login flag", async () => {
    const m = await freshModule();
    // A hard navigation: reload, Ctrl+Shift+R, or a pasted URL.
    expect(m.isPostLoginLoadingCover()).toBe(true);
    expect(m.consumePostLoginFlag()).toBe(true);
  });

  it("does not claim it again after the splash has played out", async () => {
    const m = await freshModule();
    m.consumePostLoginFlag();
    m.clearPendingPostLoginSplash();

    // Same document from here on — every later mount is a soft navigation.
    expect(m.isPostLoginLoadingCover()).toBe(false);
    expect(m.consumePostLoginFlag()).toBe(false);
  });

  it("keeps the claim across a Strict Mode remount", async () => {
    const m = await freshModule();
    expect(m.consumePostLoginFlag()).toBe(true);
    // React mounts effects twice in development; the second must still show.
    expect(m.consumePostLoginFlag()).toBe(true);
    expect(m.isPostLoginLoadingCover()).toBe(true);
  });

  it("still honours the login flag once the boot latch is spent", async () => {
    const m = await freshModule();
    m.consumePostLoginFlag();
    m.clearPendingPostLoginSplash();
    expect(m.isPostLoginLoadingCover()).toBe(false);

    // A login inside the same document (soft redirect) sets the flag.
    sessionStorage.setItem(m.POST_LOGIN_FLAG, "1");
    expect(m.isPostLoginLoadingCover()).toBe(true);
    expect(m.consumePostLoginFlag()).toBe(true);
    expect(sessionStorage.getItem(m.POST_LOGIN_FLAG)).toBeNull();
  });

  it("clears the login flag when the boot latch claims first", async () => {
    const m = await freshModule();
    sessionStorage.setItem(m.POST_LOGIN_FLAG, "1");

    expect(m.consumePostLoginFlag()).toBe(true);
    // Both are spent, so a later document does not inherit a stale flag.
    expect(sessionStorage.getItem(m.POST_LOGIN_FLAG)).toBeNull();

    m.clearPendingPostLoginSplash();
    expect(m.isPostLoginLoadingCover()).toBe(false);
  });
});
