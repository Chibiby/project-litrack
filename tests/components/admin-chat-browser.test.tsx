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
                unread: true,
              },
            ],
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Marivic Acibar/ }));
    expect(screen.getByTestId("thread-member").textContent).toBe("member-1");
  });
});

