import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelView } from "@/lib/actions/chat";

/**
 * A saved message whose follow-up read fails must not look lost (the draft is
 * already cleared, so a resend would duplicate it), and a thread that keeps
 * failing to poll must say it is stale instead of silently showing old messages.
 */

vi.mock("next/navigation", () => ({
  unstable_isUnrecognizedActionError: () => false,
}));

const readChannel = vi.fn();
const sendChatMessage = vi.fn();
vi.mock("@/lib/actions/chat", () => ({
  readChannel: (...args: unknown[]) => readChannel(...args),
  sendChatMessage: (...args: unknown[]) => sendChatMessage(...args),
  markChannelRead: vi.fn(async () => ({ ok: true })),
  listMentionTargets: vi.fn(async () => ({ ok: true, data: [] })),
  openChannel: vi.fn(),
}));

const { ChatThread } = await import("@/components/chat/chat-thread");

const CHANNEL = { id: "channel-1", messages: [] } as unknown as ChatChannelView;
const FAILURE = { ok: false, error: "Server said no" };
const STALE_COPY = "Can’t refresh right now — retrying";
const SENT_COPY = "Sent — couldn’t refresh the conversation. It will update shortly.";

function renderThread() {
  render(
    <ChatThread kind="SCHOOL" channelId="channel-1" initialChannel={CHANNEL} emptyHint="Say hello." />
  );
}

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  readChannel.mockResolvedValue({ ok: true, data: CHANNEL });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatThread — refresh failures", () => {
  it("after a sent message whose refresh fails, says so quietly and does not restore the draft", async () => {
    renderThread();
    sendChatMessage.mockResolvedValueOnce({ ok: true, data: { id: "m1" } });
    readChannel.mockResolvedValue(FAILURE);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Good morning" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    expect(screen.getByText(SENT_COPY)).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("shows a retrying line after three consecutive poll failures and clears it on the next success", async () => {
    renderThread();
    readChannel.mockResolvedValue(FAILURE);

    await tick();
    await tick();
    expect(screen.queryByText(STALE_COPY)).toBeNull();

    await tick();
    expect(screen.getByText(STALE_COPY)).toBeTruthy();

    readChannel.mockResolvedValue({ ok: true, data: CHANNEL });
    await tick();
    expect(screen.queryByText(STALE_COPY)).toBeNull();
  });
});
