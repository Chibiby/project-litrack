import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openChannel = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, data: { id: "c1" } }))
);
const readChannel = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    data: { id: "c1", kind: "SCHOOL", schoolName: "Malandag Central ES", messages: [] },
  }))
);
const markChannelRead = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const listMentionTargets = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, data: [] }))
);

vi.mock("@/lib/actions/chat", () => ({
  openChannel,
  readChannel,
  markChannelRead,
  listMentionTargets,
  sendChatMessage: vi.fn(async () => ({ ok: true as const, data: { id: "m1" } })),
}));

import { ChatThread } from "@/components/chat/chat-thread";

// jsdom does not implement Element.scrollTo; the transcript autoscrolls on mount.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

afterEach(cleanup);

describe("ChatThread", () => {
  it("shows the empty hint — not the opening state — for a conversation with no messages", async () => {
    render(<ChatThread kind="SCHOOL" emptyHint="This is your school's staff room." />);

    await waitFor(() => {
      expect(screen.getByText("This is your school's staff room.")).not.toBeNull();
    });
    expect(screen.queryByText("Opening the conversation…")).toBeNull();
  });

  it("enables the composer once an empty conversation is open", async () => {
    render(<ChatThread kind="ADMIN_DIRECT" emptyHint="A private line to the admins." />);

    await waitFor(() => {
      expect(screen.getByLabelText("Message")).not.toBeNull();
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Message") as HTMLInputElement).disabled).toBe(false);
    });
  });
});
