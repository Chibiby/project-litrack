import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelView } from "@/lib/actions/chat";

/**
 * A send that rejects outright (offline, dropped connection, deploy mid-request)
 * used to leave `sending` true forever, so the button never came back. It must
 * now show one message, keep the draft, and be usable again.
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

const CHANNEL = {
  id: "channel-1",
  messages: [],
} as unknown as ChatChannelView;

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  readChannel.mockResolvedValue({ ok: true, data: CHANNEL });
});

afterEach(cleanup);

describe("ChatThread — send failure", () => {
  it("re-enables sending, keeps the draft and shows one message after a rejected send", async () => {
    sendChatMessage.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <ChatThread
        kind="SCHOOL"
        channelId="channel-1"
        initialChannel={CHANNEL}
        emptyHint="Say hello."
      />
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Good morning" } });

    const send = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(send);
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(input.value).toBe("Good morning");
    expect(send.disabled).toBe(false);

    sendChatMessage.mockResolvedValueOnce({ ok: true, data: { id: "m1" } });
    await act(async () => {
      fireEvent.click(send);
    });
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
  });
});
