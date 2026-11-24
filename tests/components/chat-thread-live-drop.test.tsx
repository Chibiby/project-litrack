import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelView } from "@/lib/actions/chat";

/**
 * When the live socket drops, the thread must fall back to the fast poll at
 * once — not sit out the 60 s safety-net timer scheduled while it was up.
 */

vi.mock("next/navigation", () => ({ unstable_isUnrecognizedActionError: () => false }));

const readChannel = vi.fn();
// The thread polls over GET through poll-client; route it to this file's
// readChannel mock so the tests drive one source of channel data.
vi.mock("@/lib/chat/poll-client", async () => {
  const chat = await import("@/lib/actions/chat");
  const read = chat.readChannel as unknown as (input: { channelId: string }) => Promise<unknown>;
  return { pollChannel: (channelId: string) => read({ channelId }) };
});

vi.mock("@/lib/actions/chat", () => ({
  readChannel: (...a: unknown[]) => readChannel(...a),
  sendChatMessage: vi.fn(),
  editChatMessage: vi.fn(),
  deleteChatMessage: vi.fn(),
  toggleChatReaction: vi.fn(),
  markChannelRead: vi.fn(async () => ({ ok: true })),
  listMentionTargets: vi.fn(async () => ({ ok: true, data: [] })),
  openChannel: vi.fn(),
  openChatSocket: vi.fn(async () => ({ ok: true, data: { live: false } })),
}));

let liveNow = true;
vi.mock("@/components/chat/use-chat-live", () => ({
  useChatLive: () => ({
    live: liveNow,
    typingUserIds: [],
    typingNames: [],
    onlineUserIds: [],
    sendTyping: () => {},
  }),
}));

const { ChatThread } = await import("@/components/chat/chat-thread");

const VIEW: ChatChannelView = {
  id: "c1",
  kind: "SCHOOL",
  schoolName: "North ES",
  messages: [],
  viewerId: "me",
  viewerIsAdmin: false,
  readers: [],
  members: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  liveNow = true;
  readChannel.mockReset();
  readChannel.mockResolvedValue({ ok: true, data: VIEW });
  window.HTMLElement.prototype.scrollTo = vi.fn();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatThread live fallback", () => {
  it("polls within 6 s of the socket dropping", async () => {
    const view = render(<ChatThread kind="SCHOOL" channelId="c1" initialChannel={VIEW} emptyHint="Say hello." />);
    // Live: the next poll is the 60 s safety net.
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(readChannel).not.toHaveBeenCalled();

    liveNow = false;
    view.rerender(<ChatThread kind="SCHOOL" channelId="c1" initialChannel={VIEW} emptyHint="Say hello." />);
    await act(async () => {
      vi.advanceTimersByTime(6_100);
    });
    expect(readChannel).toHaveBeenCalledTimes(1);
  });
});
