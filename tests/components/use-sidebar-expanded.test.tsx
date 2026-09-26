import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_EXPANDED_KEY,
  resetSidebarExpandedPreference,
  useSidebarExpanded,
} from "@/hooks/use-sidebar-expanded";

/**
 * `resetSidebarExpandedPreference` (called on successful login) has to leave
 * NO stored preference behind — `localStorage.getItem` must read back `null`
 * — so the hook falls through to its width-based default (expanded on
 * desktop, folded in the 1024–1279px tablet-landscape band) instead of
 * carrying over whatever the previous session had toggled. A version that
 * "resets" by writing a fixed value (e.g. re-setting `"true"`) would pass a
 * shallow "does not throw" check but fail every one of these.
 */

const TABLET_LANDSCAPE_QUERY = "(min-width: 1024px) and (max-width: 1279px)";

/** Stubs `matchMedia` to report `matches` only for the tablet-landscape query. */
function mockMatchMedia(tabletLandscape: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === TABLET_LANDSCAPE_QUERY ? tabletLandscape : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("resetSidebarExpandedPreference", () => {
  it("removes the stored key entirely", () => {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, "false");
    resetSidebarExpandedPreference();
    expect(localStorage.getItem(SIDEBAR_EXPANDED_KEY)).toBeNull();
  });

  it("is a no-op (not a throw) when nothing was stored", () => {
    expect(() => resetSidebarExpandedPreference()).not.toThrow();
    expect(localStorage.getItem(SIDEBAR_EXPANDED_KEY)).toBeNull();
  });
});

describe("useSidebarExpanded — width-based default after a reset", () => {
  it("falls back to folded in the tablet-landscape band once the key is cleared", () => {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, "true");
    resetSidebarExpandedPreference();
    mockMatchMedia(true); // 1024–1279px band

    const { result } = renderHook(() => useSidebarExpanded());

    // No stored preference (removed) + narrow desktop width => folded.
    expect(localStorage.getItem(SIDEBAR_EXPANDED_KEY)).toBeNull();
    expect(result.current.expanded).toBe(false);
  });

  it("falls back to expanded outside the tablet-landscape band once the key is cleared", () => {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, "false");
    resetSidebarExpandedPreference();
    mockMatchMedia(false); // desktop width, outside the tablet band

    const { result } = renderHook(() => useSidebarExpanded());

    expect(localStorage.getItem(SIDEBAR_EXPANDED_KEY)).toBeNull();
    expect(result.current.expanded).toBe(true);
  });

  it("an explicit toggle still persists across a remount, unlike the reset", () => {
    mockMatchMedia(true);
    resetSidebarExpandedPreference();
    const { result, unmount } = renderHook(() => useSidebarExpanded());

    act(() => result.current.setExpanded(true));
    expect(localStorage.getItem(SIDEBAR_EXPANDED_KEY)).toBe("true");
    unmount();

    const { result: second } = renderHook(() => useSidebarExpanded());
    expect(second.current.expanded).toBe(true);
  });
});
