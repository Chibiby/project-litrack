import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openChannel, readChannel, listMentionTargets, markChannelRead } = vi.hoisted(() => ({
  openChannel: vi.fn(),
  readChannel: vi.fn(),
  listMentionTargets: vi.fn(async () => ({ ok: true, data: [] })),
  markChannelRead: vi.fn(),
}));
// The thread polls over GET through poll-client; route it to this file's
// readChannel mock so the tests drive one source of channel data.
vi.mock("@/lib/chat/poll-client", async () => {
  const chat = await import("@/lib/actions/chat");
  const read = chat.readChannel as unknown as (input: { channelId: string }) => Promise<unknown>;
  return { pollChannel: (channelId: string) => read({ channelId }) };
});

vi.mock("@/lib/actions/chat", () => ({ openChannel, readChannel, listMentionTargets, markChannelRead, sendChatMessage: vi.fn() }));

import { ChatThread } from "@/components/chat/chat-thread";

Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ChatThread initial view", () => {
  it("renders hydrated messages immediately without opening an existing channel", () => {
    readChannel.mockResolvedValue({ ok: true, data: { id: "channel-1", kind: "ADMIN_DIRECT", schoolName: "North", messages: [] } });
    render(<ChatThread kind="ADMIN_DIRECT" channelId="channel-1" initialChannel={{ id: "channel-1", kind: "ADMIN_DIRECT", schoolName: "North", viewerId: "me", viewerIsAdmin: false, readers: [], members: [], messages: [{ id: "m1", authorId: "u1", body: "Already loaded", createdAt: new Date(), editedAt: null, deleted: false, author: { id: "u1", displayName: "Ana", roleLabel: "Teacher", initials: "AT", isSelf: false }, mentions: [], reactions: [], replyTo: null }] }} emptyHint="Empty" />);
    expect(screen.getByText("Already loaded")).not.toBeNull();
    expect(screen.queryByText("Opening the conversation…")).toBeNull();
    expect(openChannel).not.toHaveBeenCalled();
  });
});
