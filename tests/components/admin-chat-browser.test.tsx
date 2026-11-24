import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/chat-thread", () => ({
  ChatThread: ({ memberId }: { memberId?: string }) => (
    <div data-testid="thread-member">{memberId ?? "none"}</div>
  ),
}));

import { AdminChatBrowser } from "@/components/chat/admin-chat-browser";

afterEach(cleanup);

describe("AdminChatBrowser", () => {
  it("passes the private thread member id when an admin opens a direct concern", () => {
    render(
      <AdminChatBrowser
        schools={[
          {
            schoolId: "school-1",
            schoolName: "Malandag Central ES",
            isDemoSchool: false,
            staffRoom: null,
            directThreads: [
              {
                id: "channel-1",
                memberId: "member-1",
                memberName: "Marivic Acibar",
                memberRole: "Teacher",
                lastMessageAt: new Date(),
                lastOnlineAt: new Date(),
                unread: true,
              },
            ],
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Marivic Acibar/ }));
    expect(screen.getByTestId("thread-member").textContent).toBe("member-1");
    expect(screen.getByText("Online")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Start a conversation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More conversation actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to conversations" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Search messages" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("uses a neutral header for a school room instead of claiming one person is online", () => {
    render(
      <AdminChatBrowser
        schools={[
          {
            schoolId: "school-1",
            schoolName: "Malandag Central ES",
            isDemoSchool: false,
            staffRoom: {
              id: "school-room",
              lastMessageAt: new Date(),
              unread: false,
            },
            directThreads: [],
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Malandag Central ES/ }));
    expect(screen.getByText("School conversation")).not.toBeNull();
    expect(screen.queryByText("Online")).toBeNull();
  });

  it("row shows the last message preview and an online dot when lastOnlineAt within 3 min", () => {
    render(
      <AdminChatBrowser
        schools={[
          {
            schoolId: "school-1",
            schoolName: "Malandag Central ES",
            isDemoSchool: false,
            staffRoom: { id: "room", lastMessageAt: new Date(), unread: false, preview: "Ana: Can I ask?" },
            directThreads: [
              {
                id: "online-thread",
                memberId: "m-1",
                memberName: "Marivic Acibar",
                memberRole: "Teacher",
                lastMessageAt: new Date(),
                lastOnlineAt: new Date(Date.now() - 60_000),
                unread: false,
                preview: "You: Fixed now",
              },
              {
                id: "away-thread",
                memberId: "m-2",
                memberName: "Jose Rizal",
                memberRole: "School Head",
                lastMessageAt: new Date(),
                lastOnlineAt: new Date(Date.now() - 10 * 60_000),
                unread: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Ana: Can I ask?")).not.toBeNull();
    expect(screen.getByText("You: Fixed now")).not.toBeNull();
    const online = screen.getByRole("button", { name: /Marivic Acibar/ });
    const away = screen.getByRole("button", { name: /Jose Rizal/ });
    expect(online.querySelector("[data-online]")).not.toBeNull();
    expect(away.querySelector("[data-online]")).toBeNull();
    expect(online.textContent).toContain("Active now");
  });

  it("marks a demo school's conversation and hides the badge for a real one", () => {
    render(
      <AdminChatBrowser
        schools={[
          {
            schoolId: "school-1",
            schoolName: "Malandag Central ES",
            isDemoSchool: false,
            staffRoom: {
              id: "school-room",
              lastMessageAt: new Date(),
              unread: false,
            },
            directThreads: [],
          },
          {
            schoolId: "school-2",
            schoolName: "Test Lab Demo School",
            isDemoSchool: true,
            staffRoom: {
              id: "demo-room",
              lastMessageAt: new Date(),
              unread: false,
            },
            directThreads: [],
          },
        ]}
      />
    );

    expect(screen.getAllByText("Demo")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Test Lab Demo School/ }));
    expect(screen.getAllByText("Demo")).toHaveLength(2);
  });
});
