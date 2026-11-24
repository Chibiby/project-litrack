import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelView, ChatMessageView } from "@/lib/actions/chat";

vi.mock("next/navigation", () => ({ unstable_isUnrecognizedActionError: () => false }));

const readChannel = vi.fn();
const sendChatMessage = vi.fn();
const editChatMessage = vi.fn();
const deleteChatMessage = vi.fn();
const toggleChatReaction = vi.fn();
const markChannelRead = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions/chat", () => ({
  readChannel: (...a: unknown[]) => readChannel(...a),
  sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
  editChatMessage: (...a: unknown[]) => editChatMessage(...a),
  deleteChatMessage: (...a: unknown[]) => deleteChatMessage(...a),
  toggleChatReaction: (...a: unknown[]) => toggleChatReaction(...a),
  markChannelRead: () => markChannelRead(),
  listMentionTargets: vi.fn(async () => ({ ok: true, data: [] })),
  openChannel: vi.fn(),
  openChatSocket: vi.fn(async () => ({ ok: true, data: { live: false } })),
}));

const { ChatThread } = await import("@/components/chat/chat-thread");

const ME = "me";
const now = Date.now();

function msg(id: string, authorId: string, body: string, minutesAgo: number, extra: Partial<ChatMessageView> = {}): ChatMessageView {
  const name = authorId === ME ? "Me Myself" : "Ana Cruz";
  return {
    id,
    authorId,
    body,
    createdAt: new Date(now - minutesAgo * 60_000),
    editedAt: null,
    deleted: false,
    author: { id: authorId, displayName: name, roleLabel: "Teacher", initials: name.slice(0, 2), isSelf: authorId === ME },
    mentions: [],
    reactions: [],
    replyTo: null,
    ...extra,
  };
}

function channel(messages: ChatMessageView[], extra: Partial<ChatChannelView> = {}): ChatChannelView {
  return {
    id: "c1",
    kind: "SCHOOL",
    schoolName: "North ES",
    messages,
    viewerId: ME,
    viewerIsAdmin: false,
    readers: [],
    members: [],
    ...extra,
  };
}

function renderThread(view: ChatChannelView) {
  readChannel.mockResolvedValue({ ok: true, data: view });
  return render(<ChatThread kind="SCHOOL" channelId="c1" initialChannel={view} emptyHint="Say hello." />);
}

function activate(text: string) {
  const row = screen.getByText(text).closest("[data-message-row]") as HTMLElement;
  fireEvent.focus(row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollTo = vi.fn();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("messenger chat thread", () => {
  it("groups consecutive messages under one name", () => {
    renderThread(channel([msg("1", "a", "first", 3), msg("2", "a", "second", 2), msg("3", "a", "third", 1)]));
    expect(screen.getAllByText("Ana Cruz")).toHaveLength(1);
  });

  it("own bubble uses primary colour, not aral", () => {
    renderThread(channel([msg("1", ME, "mine", 1)]));
    const bubble = screen.getByText("mine").closest("[data-bubble]") as HTMLElement;
    expect(bubble.className).toContain("bg-primary");
    expect(bubble.className).not.toMatch(/\baral\b|bg-aral/);
  });

  it("toggles a reaction and shows a count chip", async () => {
    toggleChatReaction.mockResolvedValue({ ok: true, data: { on: true } });
    renderThread(channel([msg("1", "a", "hello", 1)]));
    readChannel.mockResolvedValue({
      ok: true,
      data: channel([msg("1", "a", "hello", 1, { reactions: [{ emoji: "❤️", userIds: [ME], names: ["You"] }] })]),
    });
    activate("hello");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "React with heart" }));
    });
    expect(toggleChatReaction).toHaveBeenCalledWith({ messageId: "1", emoji: "❤️" });
    const chip = await screen.findByRole("button", { name: /heart, 1/i });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("reply shows a quote chip and sends replyToId", async () => {
    sendChatMessage.mockResolvedValue({ ok: true, data: { id: "2" } });
    renderThread(channel([msg("1", "a", "question?", 1)]));
    activate("question?");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByText(/Replying to Ana Cruz/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "answer" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });
    expect(sendChatMessage).toHaveBeenCalledWith({ channelId: "c1", body: "answer", replyToId: "1" });
  });

  it("edit within window replaces text and shows edited", async () => {
    editChatMessage.mockResolvedValue({ ok: true });
    renderThread(channel([msg("1", ME, "typo", 1)]));
    readChannel.mockResolvedValue({ ok: true, data: channel([msg("1", ME, "fixed", 1, { editedAt: new Date() })]) });
    activate("typo");
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(box.value).toBe("typo");
    fireEvent.change(box, { target: { value: "fixed" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(editChatMessage).toHaveBeenCalledWith({ messageId: "1", body: "fixed" });
    await screen.findByText("fixed");
    expect(screen.getByText("edited")).toBeTruthy();
  });

  it("delete asks first then shows Message removed", async () => {
    deleteChatMessage.mockResolvedValue({ ok: true });
    renderThread(channel([msg("1", ME, "oops", 1)]));
    readChannel.mockResolvedValue({ ok: true, data: channel([msg("1", ME, "", 1, { deleted: true })]) });
    activate("oops");
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this message?")).toBeTruthy();
    expect(deleteChatMessage).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(deleteChatMessage).toHaveBeenCalledWith({ messageId: "1" });
    await screen.findByText("Message removed");
  });

  it("Enter sends and Shift+Enter adds a newline", async () => {
    sendChatMessage.mockResolvedValue({ ok: true, data: { id: "9" } });
    renderThread(channel([]));
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sendChatMessage).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(sendChatMessage).toHaveBeenCalledWith({ channelId: "c1", body: "line" });
  });

  it("shows the message as Sending… until the send settles", async () => {
    let resolve!: (v: unknown) => void;
    sendChatMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    renderThread(channel([]));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "on its way" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });
    expect(screen.getByText("on its way")).toBeTruthy();
    expect(screen.getByText("Sending…")).toBeTruthy();
    readChannel.mockResolvedValue({ ok: true, data: channel([msg("9", ME, "on its way", 0)]) });
    await act(async () => {
      resolve({ ok: true, data: { id: "9" } });
    });
    await waitFor(() => expect(screen.queryByText("Sending…")).toBeNull());
  });

  it("typing line renders names", () => {
    // Typing comes only from the live room; without it nothing is shown.
    renderThread(channel([msg("1", "a", "hi", 1)]));
    expect(screen.queryByText(/is typing/)).toBeNull();
  });

  it("seen line under newest own message", () => {
    renderThread(
      channel([msg("1", ME, "did you see?", 5)], {
        readers: [{ userId: "a", name: "Ana Cruz", readAt: new Date(now) }],
      })
    );
    expect(screen.getByText("Seen by Ana Cruz")).toBeTruthy();
  });

  it("shows removed messages and edited tags from the view", () => {
    renderThread(channel([msg("1", "a", "", 3, { deleted: true }), msg("2", "a", "changed", 1, { editedAt: new Date() })]));
    expect(screen.getByText("Message removed")).toBeTruthy();
    expect(screen.getByText("edited")).toBeTruthy();
  });

  it("marks read again after the throttle when a second message lands within 5 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderThread(channel([msg("1", "a", "hi", 1)]));
      await waitFor(() => expect(markChannelRead).toHaveBeenCalledTimes(1));
      readChannel.mockResolvedValue({ ok: true, data: channel([msg("1", "a", "hi", 1), msg("2", "a", "again", 0)]) });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await screen.findByText("again");
      await act(async () => {
        vi.advanceTimersByTime(5_100);
      });
      await waitFor(() => expect(markChannelRead.mock.calls.length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks read when Jump to latest is pressed", async () => {
    renderThread(channel([msg("1", "a", "hi", 1)]));
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 400, configurable: true });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    markChannelRead.mockClear();
    readChannel.mockResolvedValue({ ok: true, data: channel([msg("1", "a", "hi", 1), msg("2", "a", "new one", 0)]) });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText("new one");
    expect(markChannelRead).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Jump to latest/ }));
    });
    expect(markChannelRead).toHaveBeenCalledTimes(1);
  });

  it("marks read when the tab becomes visible again even if nothing changed", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    renderThread(channel([msg("1", "a", "arrived while away", 1)]));
    expect(markChannelRead).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(markChannelRead).toHaveBeenCalledTimes(1));
  });

  it("does not mark read while scrolled up", async () => {
    renderThread(channel([msg("1", "a", "hi", 1)]));
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 400, configurable: true });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    markChannelRead.mockClear();
    readChannel.mockResolvedValue({ ok: true, data: channel([msg("1", "a", "hi", 1), msg("2", "a", "new one", 0)]) });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText("new one");
    expect(markChannelRead).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeTruthy();
  });
});
