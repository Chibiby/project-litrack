import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openChatSocket = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/chat", () => ({ openChatSocket }));

const { useChatLive, LIVE_BACKOFF_MS, TYPING_THROTTLE_MS } = await import("@/components/chat/use-chat-live");

class FakeSocket {
  static all: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  openChatSocket.mockResolvedValue({ ok: true, data: { live: true, ticket: "t-1", url: "/chat-ws" } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useChatLive", () => {
  it("falls back to polling when ticket says live false", async () => {
    openChatSocket.mockResolvedValue({ ok: true, data: { live: false } });
    const { result } = renderHook(() => useChatLive("c1", () => {}));
    await flush();
    expect(result.current.live).toBe(false);
    expect(FakeSocket.all).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(openChatSocket).toHaveBeenCalledTimes(1);
  });

  it("opens a socket with the ticket and goes live", async () => {
    const { result } = renderHook(() => useChatLive("c1", () => {}));
    await flush();
    expect(FakeSocket.all[0].url).toMatch(/^ws:\/\/[^/]+\/chat-ws\?ticket=t-1$/);
    act(() => FakeSocket.all[0].open());
    expect(result.current.live).toBe(true);
  });

  it("falls back after three socket errors", async () => {
    const { result } = renderHook(() => useChatLive("c1", () => {}));
    for (let i = 0; i < 3; i += 1) {
      await flush();
      act(() => FakeSocket.all.at(-1)!.drop());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_BACKOFF_MS[i] ?? 0);
      });
    }
    await flush();
    expect(FakeSocket.all).toHaveLength(3);
    expect(result.current.live).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("reconnects with a fresh ticket after close", async () => {
    renderHook(() => useChatLive("c1", () => {}));
    await flush();
    act(() => FakeSocket.all[0].open());
    openChatSocket.mockResolvedValue({ ok: true, data: { live: true, ticket: "t-2", url: "/chat-ws" } });
    act(() => FakeSocket.all[0].drop(4001));
    await flush();
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[1].url).toContain("ticket=t-2");
  });

  it("forwards message events to onChange", async () => {
    const onChange = vi.fn();
    renderHook(() => useChatLive("c1", onChange));
    await flush();
    act(() => {
      FakeSocket.all[0].open();
      FakeSocket.all[0].receive({ type: "message.created", messageId: "m1", at: "x" });
      FakeSocket.all[0].receive({ type: "pong" });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "message.created", messageId: "m1" }));
  });

  it("exposes typing names and presence from frames", async () => {
    const { result } = renderHook(() => useChatLive("c1", () => {}));
    await flush();
    act(() => {
      FakeSocket.all[0].open();
      FakeSocket.all[0].receive({ type: "typing", userIds: ["u2"], names: ["Ben"] });
      FakeSocket.all[0].receive({ type: "presence", userIds: ["u2", "u3"] });
    });
    expect(result.current.typingNames).toEqual(["Ben"]);
    expect(result.current.typingUserIds).toEqual(["u2"]);
    expect(result.current.onlineUserIds).toEqual(["u2", "u3"]);
  });

  it("throttles typing frames", async () => {
    const { result } = renderHook(() => useChatLive("c1", () => {}));
    await flush();
    act(() => FakeSocket.all[0].open());
    act(() => {
      result.current.sendTyping(true);
      result.current.sendTyping(true);
      result.current.sendTyping(true);
    });
    expect(FakeSocket.all[0].sent).toEqual(['{"type":"typing","on":true}']);
    act(() => vi.advanceTimersByTime(TYPING_THROTTLE_MS + 1));
    act(() => result.current.sendTyping(true));
    act(() => result.current.sendTyping(false));
    expect(FakeSocket.all[0].sent).toEqual([
      '{"type":"typing","on":true}',
      '{"type":"typing","on":true}',
      '{"type":"typing","on":false}',
    ]);
  });
});
