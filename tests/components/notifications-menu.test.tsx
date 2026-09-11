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
import { RELEASES } from "@/lib/releases";

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

describe("NotificationsMenu — release history", () => {
  it("keeps the latest releases as history, each linking to its notes", async () => {
    render(<NotificationsMenu notifications={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const history = await screen.findByRole("list", { name: "Release history" });
    const links = history.querySelectorAll("a");
    expect(links.length).toBe(Math.min(5, RELEASES.length));
    expect(links[0].textContent).toContain(
      `LITRACK System updated to v${RELEASES[0].version}`
    );
    expect(links[0].getAttribute("href")).toBe(`/releases#v${RELEASES[0].version}`);
    expect(screen.getByRole("link", { name: "All releases" }).getAttribute("href")).toBe(
      "/releases"
    );
  });

  it("does not count the history toward the unread badge", () => {
    render(<NotificationsMenu notifications={[]} />);
    expect(
      screen.getByRole("button", { name: "Notifications, none unread" })
    ).toBeTruthy();
  });
});
