import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AD_VIDEO_SRC, LoginAdReel } from "@/components/auth/login-ad-reel";

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

/**
 * jsdom has no layout. Give the legal line a bottom of 720 and everything
 * else a top of 400 in a 600px-wide column: room for a 296px-tall video.
 */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const legal = this.hasAttribute("data-login-legal");
    return { top: legal ? 690 : 400, bottom: legal ? 720 : 400, left: 0, right: 600, width: 600, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
}

function Page({ withForm = false }: { withForm?: boolean }) {
  return (
    <>
      <LoginAdReel placement="brand" />
      <div>
        {withForm ? (
          <form onSubmit={(e) => e.preventDefault()}>
            <button type="submit">Sign in</button>
          </form>
        ) : null}
        <p data-login-legal="">Terms</p>
      </div>
    </>
  );
}

const video = () => document.querySelector("video");

describe("LoginAdReel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    // jsdom has no requestIdleCallback; the component falls back to arming directly.
    Object.defineProperty(window, "requestIdleCallback", { value: undefined, configurable: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    // jsdom does not implement media playback.
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    stubLayout();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("appears on desktop after the page has been quiet: one looping video, no browser controls, no autoplay, no preload", () => {
    setDesktop(true);
    render(<Page />);
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(v.getAttribute("src")).toBe(AD_VIDEO_SRC);
    expect(AD_VIDEO_SRC).toMatch(/\/site\/litrack-ads\.mp4$/);
    expect(v.getAttribute("preload")).toBe("none");
    expect(v.loop).toBe(true);
    expect(v.autoplay).toBe(false);
    expect(v.controls).toBe(false);
  });

  it("ends level with the bottom of the legal line", () => {
    setDesktop(true);
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const frame = (video() as HTMLVideoElement).closest("figure") as HTMLElement;
    // Room: 720 - 400 - 24 = 296px tall; 600px wide gives a 337.5px-tall 16:9
    // box, so the height wins: 296 tall, 526.2 wide, 24px from the tagline.
    expect(parseFloat(frame.style.height)).toBeCloseTo(296, 0);
    expect(parseFloat(frame.style.width)).toBeCloseTo(296 * (16 / 9), 0);
    expect(parseFloat(frame.style.marginTop)).toBeCloseTo(24, 0);
  });

  it("plays from the centre button and pauses on a second click", () => {
    setDesktop(true);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    Object.defineProperty(v, "paused", { configurable: true, get: () => !play.mock.calls.length || pausedAfter });
    let pausedAfter = false;
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
      pausedAfter = true;
      this.dispatchEvent(new Event("pause"));
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Play video" }), { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pause video" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });

  it("mutes and unmutes from the volume icon, and offers full screen", () => {
    setDesktop(true);
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(v.muted).toBe(true);
    fireEvent.volumeChange(v);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(v.muted).toBe(false);
    fireEvent.volumeChange(v);
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.3" } });
    expect(v.volume).toBeCloseTo(0.3);
    expect(screen.getByRole("button", { name: "Full screen" })).toBeTruthy();
  });

  it("closes from the X and stays closed for the session", () => {
    setDesktop(true);
    const { unmount } = render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    expect(video()).toBeNull();
    unmount();
    render(<Page />);
    act(() => vi.advanceTimersByTime(10000));
    expect(video()).toBeNull();
  });

  it("has a timeline to seek", () => {
    setDesktop(true);
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    Object.defineProperty(v, "duration", { configurable: true, value: 445 });
    fireEvent.loadedMetadata(v);
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "200" } });
    expect(v.currentTime).toBe(200);
  });

  it("shows under the sign-in card on phones and tablets", () => {
    setDesktop(true);
    render(<LoginAdReel placement="card" />);
    act(() => vi.advanceTimersByTime(4100));
    expect(video()).not.toBeNull();
  });

  it("waits while the person is typing", () => {
    setDesktop(true);
    render(<Page />);
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.keyDown(window, { key: "a" });
    act(() => vi.advanceTimersByTime(3000));
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(video()).not.toBeNull();
  });

  it("never appears once a sign-in form is submitted, and leaves when one is", () => {
    setDesktop(true);
    const { container } = render(<Page withForm />);
    act(() => vi.advanceTimersByTime(4100));
    expect(container.querySelector("video")).not.toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(container.querySelector("video")).toBeNull();
  });

  it("does not load on phones and tablets", () => {
    setDesktop(false);
    render(<Page />);
    act(() => vi.advanceTimersByTime(10000));
    expect(video()).toBeNull();
  });
});
