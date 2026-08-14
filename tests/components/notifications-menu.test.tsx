import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import {
  NotificationsMenu,
  type ShellNotification,
} from "@/components/shell/notifications-menu";

afterEach(cleanup);

const items: ShellNotification[] = [
  {
    id: "aral-pending",
    title: "1 ARAL profile incomplete",
    description: "Finish Sections B–E to unlock reporting.",
    href: "/teacher/aral",
    tone: "violet",
  },
  {
    id: "attendance-week",
    title: "Weekly attendance not submitted",
    description: "Due Sunday.",
    href: "/teacher/aral",
    tone: "amber",
  },
];

describe("NotificationsMenu", () => {
  it("shows the unread count in the trigger label and badge", () => {
    render(<NotificationsMenu notifications={items} />);
    const trigger = screen.getByRole("button", { name: "Notifications, 2 unread" });
    expect(trigger.textContent).toContain("2");
  });

  it("renders an empty-state label when there is nothing", () => {
    render(<NotificationsMenu notifications={[]} />);
    const trigger = screen.getByRole("button", { name: "Notifications, none unread" });
    expect(trigger.textContent).not.toContain("0");
  });

  it("lists every notification as a link when opened", async () => {
    render(<NotificationsMenu notifications={items} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const link = await screen.findByRole("link", { name: /ARAL profile incomplete/ });
    expect(link.getAttribute("href")).toBe("/teacher/aral");
    expect(
      screen.getByRole("link", { name: /Weekly attendance not submitted/ })
    ).not.toBeNull();
  });

  it("shows an empty message when opened with no notifications", async () => {
    render(<NotificationsMenu notifications={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText("You're all caught up.")).not.toBeNull();
  });
});
