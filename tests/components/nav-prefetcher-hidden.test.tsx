import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const prefetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch }),
}));

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  prefetch.mockClear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function mount(cacheKey: string) {
  vi.resetModules();
  const { NavPrefetcher } = await import("@/components/nav-prefetcher");
  render(<NavPrefetcher cacheKey={cacheKey} hrefs={["/teacher", "/teacher/settings"]} />);
}

describe("NavPrefetcher in a hidden tab", () => {
  it("does not warm while the tab is hidden", async () => {
    visibility = "hidden";
    await mount("hidden-key");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("warms as soon as the hidden tab becomes visible", async () => {
    visibility = "hidden";
    await mount("reveal-key");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(prefetch).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(prefetch).toHaveBeenCalledWith("/teacher", { kind: "full" });
  });

  it("still warms normally in a visible tab", async () => {
    await mount("visible-key");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
});
