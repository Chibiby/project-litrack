import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useNavBadges } from "@/components/nav/use-nav-badges";

/**
 * Sidebar badges arrive from the layout (often as a streamed promise, so the
 * chrome never waits on a count) and, in the admin consoles, refresh every
 * 30 s while the tab is visible.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useNavBadges", () => {
  it("uses counts handed over directly", () => {
    const { result } = renderHook(() => useNavBadges({ "teacher-aral-profiling": 3 }, false));
    expect(result.current).toEqual({ "teacher-aral-profiling": 3 });
  });

  it("shows nothing until a streamed promise settles, then its counts", async () => {
    let resolve!: (v: Record<string, number>) => void;
    const promise = new Promise<Record<string, number>>((r) => (resolve = r));
    const { result } = renderHook(() => useNavBadges(promise, false));
    expect(result.current).toBeUndefined();
    await act(async () => resolve({ "school-head-transfer": 2 }));
    expect(result.current).toEqual({ "school-head-transfer": 2 });
  });

  it("a failed count leaves the menu without badges", async () => {
    const { result } = renderHook(() => useNavBadges(Promise.reject(new Error("pool")), false));
    await act(async () => {});
    expect(result.current).toBeUndefined();
  });

  it("takes the new counts when the layout renders again", async () => {
    const { result, rerender } = renderHook(({ v }) => useNavBadges(v, false), {
      initialProps: { v: { "admin-support": 4 } as Record<string, number> },
    });
    rerender({ v: { "admin-support": 1 } });
    expect(result.current).toEqual({ "admin-support": 1 });
  });

  it("keeps the last counts while a new streamed promise is pending", async () => {
    const first = { "admin-support": 4 };
    let resolve!: (v: Record<string, number>) => void;
    const next = new Promise<Record<string, number>>((r) => (resolve = r));
    const { result, rerender } = renderHook(({ v }) => useNavBadges(v, false), {
      initialProps: { v: first as Record<string, number> | Promise<Record<string, number>> },
    });
    rerender({ v: next });
    expect(result.current).toEqual({ "admin-support": 4 });
    await act(async () => resolve({ "admin-support": 0 }));
    expect(result.current).toEqual({ "admin-support": 0 });
  });

  it("polls every 30 s when asked, keeping the other counts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { "admin-support": 9 } })));
    vi.stubGlobal("fetch", fetchMock);
    const initial = { "admin-support": 4, other: 1 };
    const { result } = renderHook(() => useNavBadges(initial, true));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/nav/badges", expect.objectContaining({ cache: "no-store" }));
    vi.useRealTimers();
    await waitFor(() => expect(result.current).toEqual({ "admin-support": 9, other: 1 }));
  });

  it("keeps the last counts when a poll fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const initial = { "admin-support": 4 };
    const { result } = renderHook(() => useNavBadges(initial, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current).toEqual({ "admin-support": 4 });
  });

  it("does not poll when not asked", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const initial = {};
    renderHook(() => useNavBadges(initial, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
