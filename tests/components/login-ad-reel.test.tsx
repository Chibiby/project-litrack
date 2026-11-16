import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginAdReel } from "@/components/auth/login-ad-reel";

function setDesktop(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const video = () => document.querySelector("video");

describe("LoginAdReel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no requestIdleCallback; the component falls back to arming directly.
    Object.defineProperty(window, "requestIdleCallback", { value: undefined, configurable: true });
    // jsdom does not implement media playback.
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("appears on desktop after the page has been quiet: one looping video, no autoplay, no preload", () => {
    setDesktop(true);
    render(<LoginAdReel />);
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(v.getAttribute("src")).toBe("/ads/litrack-ads.mp4");
    expect(v.getAttribute("preload")).toBe("none");
    expect(v.loop).toBe(true);
    expect(v.autoplay).toBe(false);
  });

  it("waits while the person is typing", () => {
    setDesktop(true);
    render(<LoginAdReel />);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.keyDown(window, { key: "a" });
    act(() => vi.advanceTimersByTime(3000));
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(video()).not.toBeNull();
  });

  it("never appears once a sign-in form is submitted, and leaves when one is", () => {
    setDesktop(true);
    const { container } = render(
      <>
        <form onSubmit={(e) => e.preventDefault()}>
          <button type="submit">Sign in</button>
        </form>
        <LoginAdReel />
      </>
    );
    act(() => vi.advanceTimersByTime(4100));
    expect(container.querySelector("video")).not.toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(container.querySelector("video")).toBeNull();
  });

  it("does not load on phones and tablets", () => {
    setDesktop(false);
    render(<LoginAdReel />);
    act(() => vi.advanceTimersByTime(10000));
    expect(video()).toBeNull();
  });
});
