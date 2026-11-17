import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AD_CLIPS,
  ENGAGED_VOLUME,
  LoginAdReel,
  QUIET_VOLUME,
  shuffleClips,
} from "@/components/auth/login-ad-reel";

function mockPlay() {
  return vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
}

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
 * jsdom has no layout. Give the sign-in card a bottom of 720 and everything
 * else a top of 400 in a 600px-wide column: room for a 296px-tall video.
 */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const legal = this.hasAttribute("data-login-card");
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
        <div data-login-card="">Card</div>
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
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    stubLayout();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("appears on desktop after the page has been quiet and plays one of the three clips on its own, quietly", () => {
    setDesktop(true);
    const play = mockPlay();
    render(<Page />);
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    expect(v).not.toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(AD_CLIPS.map((c) => c.src)).toContain(v.getAttribute("src"));
    expect(AD_CLIPS.map((c) => c.src.replace(/^.*\/site\//, ""))).toEqual([
      "litrack-ad-1.mp4",
      "litrack-ad-2.mp4",
      "litrack-ad-3.mp4",
    ]);
    expect(v.loop).toBe(false);
    expect(v.controls).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    expect(v.volume).toBeCloseTo(QUIET_VOLUME);
  });

  it("rises to half volume the first time the player is pointed at, and stays there", () => {
    setDesktop(true);
    mockPlay();
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    const frame = v.closest("figure") as HTMLElement;
    expect(v.volume).toBeCloseTo(QUIET_VOLUME);
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    expect(v.volume).toBeCloseTo(ENGAGED_VOLUME);
    v.volume = 0.2;
    fireEvent.pointerLeave(frame, { pointerType: "mouse" });
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    expect(v.volume).toBeCloseTo(0.2);
  });

  it("plays muted when the browser refuses sound, and turns the sound on at the first click", async () => {
    setDesktop(true);
    let calls = 0;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
    });
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    await act(async () => {});
    expect(v.muted).toBe(true);
    expect(calls).toBe(2);
    fireEvent.pointerDown(document.body);
    expect(v.muted).toBe(false);
  });

  it("plays every clip once, in random order, before any clip repeats", () => {
    setDesktop(true);
    const play = mockPlay();
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    const seen: string[] = [v.getAttribute("src") as string];
    for (let i = 0; i < 5; i++) {
      fireEvent.ended(v);
      seen.push(v.getAttribute("src") as string);
    }
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(new Set(seen.slice(3, 6)).size).toBe(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(play).toHaveBeenCalledTimes(6);
  });

  it("never opens a new round with the clip that just finished", () => {
    for (let k = 0; k < 50; k++) {
      const last = k % 3;
      const order = shuffleClips(3, last);
      expect([...order].sort()).toEqual([0, 1, 2]);
      expect(order[0]).not.toBe(last);
    }
  });

  it("does not autoplay or preload on phones and tablets", () => {
    setDesktop(true);
    const play = mockPlay();
    render(<LoginAdReel placement="card" />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    expect(v.getAttribute("preload")).toBe("none");
    expect(play).not.toHaveBeenCalled();
  });

  it("sits right under the tagline, no wider than 85% of the column", () => {
    setDesktop(true);
    render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    const frame = (video() as HTMLVideoElement).closest("figure") as HTMLElement;
    // Room: 720 - 400 - 24 = 296px tall. The video may use 85% of the 600px
    // column (510px), so the width wins: 286.9 tall, 24px under the tagline.
    expect(parseFloat(frame.style.height)).toBeCloseTo(510 * (9 / 16), 0);
    expect(parseFloat(frame.style.width)).toBeCloseTo(510, 0);
    expect(parseFloat(frame.style.marginTop)).toBeCloseTo(24, 0);
  });

  it("plays from the centre button and pauses on a second click", () => {
    setDesktop(true);
    let paused = true;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
      paused = true;
      this.dispatchEvent(new Event("pause"));
    });
    render(<LoginAdReel placement="card" />);
    act(() => vi.advanceTimersByTime(4100));
    const v = video() as HTMLVideoElement;
    Object.defineProperty(v, "paused", { configurable: true, get: () => paused });

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

  it("closes from the X, and comes back when the page loads again", () => {
    setDesktop(true);
    const { unmount } = render(<Page />);
    act(() => vi.advanceTimersByTime(4100));
    fireEvent.click(screen.getByRole("button", { name: "Close video" }));
    expect(video()).toBeNull();
    unmount();
    render(<Page />);
    act(() => vi.advanceTimersByTime(10000));
    expect(video()).not.toBeNull();
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

  it("holds the spot with a loader while the person is typing, then shows the player", () => {
    setDesktop(true);
    render(<Page />);
    expect(screen.getByRole("status", { name: "Loading video" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.keyDown(window, { key: "a" });
    act(() => vi.advanceTimersByTime(3000));
    expect(video()).toBeNull();
    expect(screen.getByRole("status", { name: "Loading video" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1100));
    expect(video()).not.toBeNull();
    expect(screen.queryByRole("status", { name: "Loading video" })).toBeNull();
  });

  it("stays on screen when the sign-in form is submitted, but stops its download", () => {
    setDesktop(true);
    const { container } = render(<Page withForm />);
    act(() => vi.advanceTimersByTime(4100));
    const v = container.querySelector("video") as HTMLVideoElement;
    expect(v).not.toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(container.querySelector("video")).toBe(v);
    expect(v.getAttribute("src")).toBeNull();
  });

  it("swaps the loader for the player straight away when signing in before it appeared", () => {
    setDesktop(true);
    const { container } = render(<Page withForm />);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("does not load on phones and tablets", () => {
    setDesktop(false);
    render(<Page />);
    act(() => vi.advanceTimersByTime(10000));
    expect(video()).toBeNull();
  });
});
