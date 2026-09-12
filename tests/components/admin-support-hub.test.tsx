import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
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
  refresh.mockReset();
  vi.useRealTimers();
});

describe("AdminSupportHub", () => {
  it("switches between chat and support tickets without exposing an admin ticket composer", () => {
    render(<AdminSupportHub schools={[]} tickets={[]} />);

    expect(screen.getByRole("tablist", { name: "Support sections" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Support hub tips")).toBeNull();
    expect(screen.getByTestId("admin-chat-browser")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /new ticket/i })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Support Tickets" }));

    expect(screen.getByRole("tab", { name: "Support Tickets" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("support-inbox")).not.toBeNull();
    expect(screen.queryByTestId("admin-chat-browser")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/admin/support?tab=tickets", { scroll: false });
  });

  it("refreshes current presence while the chat workspace remains visible", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    render(<AdminSupportHub schools={[]} tickets={[]} />);

    vi.advanceTimersByTime(30_000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
