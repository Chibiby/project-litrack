import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_REFRESH_INTERVAL_MS, SESSION_REFRESH_PATH } from "@/lib/auth/auth-cookies";
import { SessionKeepAlive } from "@/components/session/session-keep-alive";

const fetchMock = vi.fn();
let visible = true;
let online = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
  visible = true;
  online = true;
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 204 });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SessionKeepAlive", () => {
  it("posts to the refresh route on mount when nothing was refreshed recently", () => {
    render(<SessionKeepAlive />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SESSION_REFRESH_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("does not post again inside the interval", () => {
    render(<SessionKeepAlive />);
    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS - 60_000));
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not post on mount when another tab refreshed recently", () => {
    window.localStorage.setItem("litrack.sessionRefreshAt", String(Date.now() - 1_000));
    render(<SessionKeepAlive />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts again once the interval has elapsed", () => {
    render(<SessionKeepAlive />);
    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS + 60_000));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips while hidden and posts when the page returns to visible after the interval", () => {
    render(<SessionKeepAlive />);
    visible = false;
    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visible = true;
    fireEvent(document, new Event("visibilitychange"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips while offline", () => {
    online = false;
    render(<SessionKeepAlive />);
    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS * 2));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still works when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    render(<SessionKeepAlive />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not throw when fetch rejects or throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(() => render(<SessionKeepAlive />)).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });

    fetchMock.mockImplementationOnce(() => {
      throw new Error("sync");
    });
    expect(() => act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS + 60_000))).not.toThrow();
  });

  it("stops posting for the page life after a 401", async () => {
    fetchMock.mockResolvedValue({ status: 401 });
    render(<SessionKeepAlive />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(SESSION_REFRESH_INTERVAL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
