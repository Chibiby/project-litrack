import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@/components/chat/admin-chat-browser", () => ({
  AdminChatBrowser: () => <div data-testid="admin-chat-browser">Chat browser</div>,
}));

vi.mock("@/components/support/support-inbox", () => ({
  SupportInbox: () => <div data-testid="support-inbox">Ticket queue</div>,
}));

import { AdminSupportHub } from "@/components/admin/admin-support-hub";

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe("AdminSupportHub", () => {
  it("switches between chat and support tickets without exposing an admin ticket composer", () => {
    render(<AdminSupportHub schools={[]} tickets={[]} />);

    expect(screen.getByTestId("admin-chat-browser")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /new ticket/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Support Tickets" }));

    expect(screen.getByTestId("support-inbox")).not.toBeNull();
    expect(screen.queryByTestId("admin-chat-browser")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/admin/support?tab=tickets", { scroll: false });
  });
});

