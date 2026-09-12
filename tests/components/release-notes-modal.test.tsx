import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "LITRACK System updated to vX.Y.Z" modal.
 *
 * Two behaviours are pinned so they stay deliberate:
 *
 *   - It waits out the post-login splash. The splash owns the screen at z-9999
 *     for its first seconds; a dialog opened underneath it traps focus behind a
 *     cover nobody can see past. `AralAssignmentAlerts` waits on the same flag.
 *   - Every way of closing it acknowledges — "Got it", ✕, Escape — so closing is
 *     never a way to be shown it again.
 *
 * `@/lib/releases` is mocked to a fixed three-version history so the tests say
 * what the modal does with ANY history, not the committed one.
 */

const mockAcknowledge = vi.fn();
let covered = false;

vi.mock("@/lib/actions/release", () => ({
  acknowledgeRelease: () => mockAcknowledge(),
}));

vi.mock("@/lib/post-login-flag", () => ({
  isPostLoginLoadingCover: () => covered,
}));

let announce = true;
vi.mock("@/lib/releases", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/releases")>();
  const history = (): import("@/lib/releases").Release[] => [
    {
      version: "1.3.0",
      date: "2026-09-12",
      title: "A test release",
      announce,
      fixes: [
        "The first fix",
        "The second fix",
        { text: "An admin-only fix", roles: ["SUPER_ADMIN"] },
      ],
    },
    {
      version: "1.2.1",
      date: "2026-09-11",
      title: "A patch in between",
      announce: true,
      fixes: [{ text: "An admin-only patch", roles: ["SUPER_ADMIN"] }],
    },
    {
      version: "1.2.0",
      date: "2026-09-10",
      title: "An older release",
      announce: true,
      fixes: ["An old fix"],
    },
  ];
  return {
    APP_VERSION: "1.3.0",
    latestRelease: () => history()[0],
    unseenReleases: (lastSeen: string | null) =>
      real.unseenReleases(lastSeen, history()),
    visibleFixes: real.visibleFixes,
  };
});

import { ReleaseNotesModal } from "@/components/release-notes-modal";

beforeEach(() => {
  vi.clearAllMocks();
  covered = false;
  announce = true;
  mockAcknowledge.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HEADING = "LITRACK System updated to v1.3.0";

describe("ReleaseNotesModal — who sees it", () => {
  it("says which version the system was updated to, with every fix", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);

    expect(await screen.findByText(HEADING)).toBeTruthy();
    expect(screen.getByText("The first fix")).toBeTruthy();
    expect(screen.getByText("The second fix")).toBeTruthy();
  });

  it("shows only the current release to someone who has seen none", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);
    await screen.findByText(HEADING);

    expect(screen.queryByText("An admin-only patch")).toBeNull();
    expect(screen.queryByText("An old fix")).toBeNull();
  });

  it("lists every version released since the one they last acknowledged", async () => {
    render(<ReleaseNotesModal lastSeenVersion="1.2.0" role="SUPER_ADMIN" />);
    await screen.findByText(HEADING);

    expect(screen.getByText("The first fix")).toBeTruthy();
    expect(screen.getByText("An admin-only patch")).toBeTruthy();
    // Already acknowledged, so not repeated.
    expect(screen.queryByText("An old fix")).toBeNull();
  });

  it("renders nothing for a user who already acknowledged this version", () => {
    render(<ReleaseNotesModal lastSeenVersion="1.3.0" role="TEACHER" />);

    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("shows again to someone who saw a NEWER build that was rolled back", async () => {
    render(<ReleaseNotesModal lastSeenVersion="1.4.0" role="TEACHER" />);

    expect(await screen.findByText(HEADING)).toBeTruthy();
    expect(screen.queryByText("An admin-only patch")).toBeNull();
  });

  it("renders nothing for a release that does not announce", () => {
    announce = false;
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);

    expect(screen.queryByText(HEADING)).toBeNull();
  });
});

describe("ReleaseNotesModal — who a note is written for", () => {
  it("keeps a restricted note away from a reader outside its roles", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);
    await screen.findByText(HEADING);

    // The privacy case: a note that discloses a capability over the reader's
    // own account must not reach them through a changelog.
    expect(screen.queryByText("An admin-only fix")).toBeNull();
  });

  it("shows a restricted note to the role it names", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="SUPER_ADMIN" />);
    await screen.findByText(HEADING);

    expect(screen.getByText("An admin-only fix")).toBeTruthy();
  });

  it("skips a version whose every note is restricted away from the reader", async () => {
    // 1.2.1 is admin-only in full, so a teacher catching up from 1.2.0 sees
    // 1.3.0 and nothing else — not an empty section with a heading.
    render(<ReleaseNotesModal lastSeenVersion="1.2.0" role="TEACHER" />);
    await screen.findByText(HEADING);

    expect(screen.queryByLabelText("Version 1.2.1")).toBeNull();
    expect(screen.getByLabelText("Version 1.3.0")).toBeTruthy();
  });

  it("does not open at all when nothing unseen is for this reader", () => {
    // Only 1.2.1 is unseen, and every note in it is admin-only.
    render(<ReleaseNotesModal lastSeenVersion="1.3.0" role="TEACHER" />);

    expect(screen.queryByText(HEADING)).toBeNull();
  });
});

describe("ReleaseNotesModal — the login splash", () => {
  it("does not open while the splash covers the screen", () => {
    vi.useFakeTimers();
    covered = true;
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("opens as soon as the splash lifts", () => {
    vi.useFakeTimers();
    covered = true;
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);

    covered = false;
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByText(HEADING)).toBeTruthy();
  });
});

describe("ReleaseNotesModal — acknowledging", () => {
  it("acknowledges and closes when Got it is pressed", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);
    await screen.findByText(HEADING);

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull());
  });

  it("acknowledges on Escape too, so closing is never a way to be shown it again", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);
    const title = await screen.findByText(HEADING);

    fireEvent.keyDown(title, { key: "Escape" });

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull());
  });

  it("stays open and says why when the stamp cannot be saved", async () => {
    mockAcknowledge.mockResolvedValue({
      ok: false,
      error: "Could not save that you have seen this. Try again.",
    });
    render(<ReleaseNotesModal lastSeenVersion={null} role="TEACHER" />);
    await screen.findByText(HEADING);

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    // Closing on failure would show it again on the next page with no
    // explanation. Staying open lets them retry, and says what happened.
    expect(await screen.findByText(/could not save/i)).toBeTruthy();
    expect(screen.getByText(HEADING)).toBeTruthy();
  });
});
