import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "what's new" modal (§2 of the ten concerns).
 *
 * Two behaviours here depart from the approved plan, each on the strength of a
 * precedent already in the app, and both are pinned so they stay deliberate:
 *
 *   - It waits out the post-login splash. The splash owns the screen at z-9999
 *     for its first seconds; a dialog opened underneath it traps focus behind a
 *     cover nobody can see past. `AralAssignmentAlerts` waits on the same flag.
 *   - Every way of closing it acknowledges — "Got it", ✕, Escape. The plan made
 *     Escape and ✕ inert so that only the button stamped; the ARAL alerts dialog
 *     instead treats any close as the acknowledgement, which removes the reason
 *     for the inert ✕ without re-showing the modal on the next page.
 */

const mockAnnounce = vi.fn();
const mockAcknowledge = vi.fn();
let covered = false;

vi.mock("@/lib/actions/release", () => ({
  announceRelease: () => mockAnnounce(),
  acknowledgeRelease: () => mockAcknowledge(),
}));

vi.mock("@/lib/post-login-flag", () => ({
  isPostLoginLoadingCover: () => covered,
}));

let announce = true;
vi.mock("@/lib/releases", () => ({
  latestRelease: () => ({
    version: "1.1.0",
    date: "2026-09-11",
    title: "A test release",
    announce,
    fixes: ["The first fix", "The second fix"],
  }),
}));

import {
  ReleaseNotesModal,
  RELEASE_ACKNOWLEDGED_EVENT,
} from "@/components/release-notes-modal";

beforeEach(() => {
  vi.clearAllMocks();
  covered = false;
  announce = true;
  mockAnnounce.mockResolvedValue({ ok: true });
  mockAcknowledge.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReleaseNotesModal — who sees it", () => {
  it("shows the title and every fix to a user who has seen nothing", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} />);

    expect(await screen.findByText("A test release")).toBeTruthy();
    expect(screen.getByText("The first fix")).toBeTruthy();
    expect(screen.getByText("The second fix")).toBeTruthy();
  });

  it("still shows for a user who acknowledged an older version", async () => {
    render(<ReleaseNotesModal lastSeenVersion="1.0.0" />);

    expect(await screen.findByText("A test release")).toBeTruthy();
  });

  it("renders nothing for a user who already acknowledged this version", () => {
    render(<ReleaseNotesModal lastSeenVersion="1.1.0" />);

    expect(screen.queryByText("A test release")).toBeNull();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("shows again to someone who saw a NEWER build that was rolled back", async () => {
    // Equality, not ordering: "has not acknowledged THIS release" is the question,
    // and it is true for them too. Re-showing is right; they never saw 1.1.0's
    // notes as 1.1.0.
    render(<ReleaseNotesModal lastSeenVersion="1.2.0" />);

    expect(await screen.findByText("A test release")).toBeTruthy();
  });

  it("renders nothing for a release that does not announce", () => {
    announce = false;
    render(<ReleaseNotesModal lastSeenVersion={null} />);

    expect(screen.queryByText("A test release")).toBeNull();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});

describe("ReleaseNotesModal — the bell row", () => {
  it("records the bell row once, not on every render", async () => {
    const { rerender } = render(<ReleaseNotesModal lastSeenVersion={null} />);
    await waitFor(() => expect(mockAnnounce).toHaveBeenCalledTimes(1));

    rerender(<ReleaseNotesModal lastSeenVersion={null} />);

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });
});

describe("ReleaseNotesModal — the login splash", () => {
  it("does not open, or announce, while the splash covers the screen", () => {
    vi.useFakeTimers();
    covered = true;
    render(<ReleaseNotesModal lastSeenVersion={null} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("A test release")).toBeNull();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("opens as soon as the splash lifts", () => {
    vi.useFakeTimers();
    covered = true;
    render(<ReleaseNotesModal lastSeenVersion={null} />);

    covered = false;
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByText("A test release")).toBeTruthy();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });
});

describe("ReleaseNotesModal — acknowledging", () => {
  it("acknowledges and closes when Got it is pressed", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    await screen.findByText("A test release");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("A test release")).toBeNull());
  });

  it("acknowledges on Escape too, so closing is never a way to be shown it again", async () => {
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    const title = await screen.findByText("A test release");

    fireEvent.keyDown(title, { key: "Escape" });

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("A test release")).toBeNull());
  });

  it("tells the shell, so the bell can show the row it just wrote", async () => {
    const heard = vi.fn();
    window.addEventListener(RELEASE_ACKNOWLEDGED_EVENT, heard);
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    await screen.findByText("A test release");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    window.removeEventListener(RELEASE_ACKNOWLEDGED_EVENT, heard);
  });

  it("stays open and says why when the stamp cannot be saved", async () => {
    mockAcknowledge.mockResolvedValue({
      ok: false,
      error: "Could not save that you have seen this. Try again.",
    });
    render(<ReleaseNotesModal lastSeenVersion={null} />);
    await screen.findByText("A test release");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    // Closing on failure would show it again on the next page with no
    // explanation. Staying open lets them retry, and says what happened.
    expect(await screen.findByText(/could not save/i)).toBeTruthy();
    expect(screen.getByText("A test release")).toBeTruthy();
  });
});
