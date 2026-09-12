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
});
