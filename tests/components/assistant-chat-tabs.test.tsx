import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Switching between "School chat" and "Ask admin" must not carry one room's
 * transcript — or its channel id — into the other. Both tabs render a
 * ChatThread in the same JSX slot, so the two elements need distinct keys or
 * React reuses a single instance across the switch.
 */

const CHANNELS = {
  SCHOOL: "school-1",
  ADMIN_DIRECT: "admin-1",
} as const;

const MESSAGES: Record<string, { id: string; body: string }[]> = {
  "school-1": [{ id: "m1", body: "staff room line" }],
  "admin-1": [{ id: "m2", body: "admin line" }],
};

const sentTo = vi.hoisted(() => [] as string[]);

vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/assistant", () => ({ askAssistant: vi.fn() }));
vi.mock("@/lib/actions/support", () => ({ fetchMyTickets: vi.fn(async () => ({ ok: true, data: [] })) }));
vi.mock("@/lib/actions/chat", () => ({
  getMyChatUnread: vi.fn(async () => ({ ok: true, data: { school: false, admin: false } })),
  openChannel: vi.fn(async ({ kind }: { kind: keyof typeof CHANNELS }) => ({
    ok: true,
    data: { id: CHANNELS[kind] },
  })),
  readChannel: vi.fn(async ({ channelId }: { channelId: string }) => ({
    ok: true,
    data: {
      id: channelId,
      kind: "SCHOOL",
      schoolName: "Malandag Central ES",
      messages: MESSAGES[channelId].map((m) => ({
        ...m,
        createdAt: new Date(),
        author: {
          id: "u1",
          displayName: "Marivic Acibar",
          roleLabel: "Teacher",
          initials: "MA",
          isSelf: false,
        },
        mentions: [],
      })),
    },
  })),
  markChannelRead: vi.fn(async () => ({ ok: true })),
  listMentionTargets: vi.fn(async () => ({ ok: true, data: [] })),
  sendChatMessage: vi.fn(async ({ channelId }: { channelId: string }) => {
    sentTo.push(channelId);
    return { ok: true, data: { id: "new" } };
  }),
}));

import { AssistantPanel } from "@/components/assistant/assistant-panel";

// jsdom does not implement Element.scrollTo; both logs autoscroll on update.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

afterEach(() => {
  sentTo.length = 0;
  cleanup();
});

function renderPanel() {
  render(
    <AssistantPanel
      role="TEACHER"
      userName="Marivic"
      aiEnabled={false}
      active
      onMinimize={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("AssistantPanel chat tabs", () => {
  it("does not carry the staff room transcript into the admin thread", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /School chat/ }));
    await waitFor(() => expect(screen.getByText("staff room line")).not.toBeNull());

    fireEvent.click(screen.getByRole("tab", { name: /Ask admin/ }));
    expect(screen.queryByText("staff room line")).toBeNull();
    await waitFor(() => expect(screen.getByText("admin line")).not.toBeNull());
  });

  it("sends a message to the room that is on screen", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: /School chat/ }));
    await waitFor(() => expect(screen.getByText("staff room line")).not.toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Ask admin/ }));
    await waitFor(() => expect(screen.getByText("admin line")).not.toBeNull());

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(sentTo).toEqual([CHANNELS.ADMIN_DIRECT]));
  });
});
