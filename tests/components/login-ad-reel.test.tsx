import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("LoginAdReel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
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

  it("appears on desktop only after the page has been quiet, with no autoplay or preload", () => {
    setDesktop(true);
    render(<LoginAdReel />);
    expect(screen.queryByRole("complementary")).toBeNull();
    act(() => vi.advanceTimersByTime(4100));
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.autoplay).toBe(false);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(2);
  });

  it("waits while the person is typing", () => {
    setDesktop(true);
    render(<LoginAdReel />);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.keyDown(window, { key: "a" });
    act(() => vi.advanceTimersByTime(3000));
    expect(document.querySelector("video")).toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(document.querySelector("video")).not.toBeNull();
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
    expect(document.querySelector("video")).toBeNull();
  });

  it("stays closed for the session once closed", () => {
    setDesktop(true);
    const { unmount } = render(<LoginAdReel />);
    act(() => vi.advanceTimersByTime(4100));
    fireEvent.click(screen.getByRole("button", { name: "Close videos" }));
    expect(document.querySelector("video")).toBeNull();
    unmount();
    render(<LoginAdReel />);
    act(() => vi.advanceTimersByTime(10000));
    expect(document.querySelector("video")).toBeNull();
  });
});
