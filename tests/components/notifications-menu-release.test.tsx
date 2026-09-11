import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bell's half of §2: "what was that thing I dismissed".
 *
 * The approved plan wrote a `RELEASE_PUBLISHED` row and never read it — the
 * teacher and School Head bells show only what their layouts pass, and no layout
 * passed notification rows. These tests pin the reader that closes that gap: it
 * is opt-in, it lists the row first, it re-fetches when the modal acknowledges,
 * and opening the row is what reads it.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
const mockDismiss = vi.fn();
vi.mock("@/lib/actions/release", () => ({
  fetchReleaseAlert: () => mockFetch(),
  dismissReleaseAlert: (id: string) => mockDismiss(id),
  announceRelease: vi.fn(),
  acknowledgeRelease: vi.fn(),
}));

import { NotificationsMenu } from "@/components/shell/notifications-menu";
import { RELEASE_ACKNOWLEDGED_EVENT } from "@/components/release-notes-modal";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "What's new in LITRACK 1.1.0",
  description: "A test release",
  href: "/releases",
  tone: "amber" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(ROW);
  mockDismiss.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function openBell() {
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
}

describe("NotificationsMenu — the release row", () => {
  it("does not ask for a release row unless told to", () => {
    render(<NotificationsMenu notifications={[]} />);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("counts and lists the unread release row", async () => {
    render(<NotificationsMenu notifications={[]} releaseAlerts />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications, 1 unread" })
      ).toBeTruthy()
    );
    openBell();
    expect(screen.getByText("What's new in LITRACK 1.1.0")).toBeTruthy();
    expect(screen.getByText("What's new in LITRACK 1.1.0").closest("a")?.getAttribute("href")).toBe(
      "/releases"
    );
  });

  it("marks the row read when it is opened, and drops it from the bell", async () => {
    render(<NotificationsMenu notifications={[]} releaseAlerts />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    openBell();

    fireEvent.click(await screen.findByText("What's new in LITRACK 1.1.0"));

    expect(mockDismiss).toHaveBeenCalledWith(ROW.id);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications, none unread" })
      ).toBeTruthy()
    );
  });

  it("re-fetches when the modal reports an acknowledgement", async () => {
    // The first fetch ran before the modal wrote the row.
    mockFetch.mockResolvedValueOnce(null);
    render(<NotificationsMenu notifications={[]} releaseAlerts />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event(RELEASE_ACKNOWLEDGED_EVENT));
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications, 1 unread" })
      ).toBeTruthy()
    );
  });
});
