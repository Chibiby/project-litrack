import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The unlock-grant modal: a copy of `AralAssignmentAlerts` with the actions,
 * alert type and copy swapped for a reopened submission window.
 *
 * Two behaviours are pinned here because they are easy to lose in a refactor:
 *
 *   - It waits out the post-login splash, same reasoning as the ARAL modal.
 *   - It defers while another Radix dialog (e.g. `AralAssignmentAlerts`) is
 *     open, so the two never stack. The "no-stacking" tests at the bottom are
 *     load-bearing: the race test in particular only passes when the stacking
 *     check runs after `fetchUnlockAlerts` resolves, not before it.
 */

let covered = false;
vi.mock("@/lib/post-login-flag", () => ({
  isPostLoginLoadingCover: () => covered,
}));

const fetchUnlockAlerts = vi.fn();
const dismissUnlockAlerts = vi.fn();
vi.mock("@/lib/actions/notifications", () => ({
  fetchUnlockAlerts: () => fetchUnlockAlerts(),
  dismissUnlockAlerts: (ids: string[]) => dismissUnlockAlerts(ids),
}));

import { UnlockGrantAlerts } from "@/components/notifications/unlock-grant-alerts";

const ONE_ALERT = [
  {
    id: "alert-1",
    title: "Monthly reading level reopened.",
    description: "August 2026. Open until September 7, 2026.",
    href: "/teacher/aral",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  covered = false;
  fetchUnlockAlerts.mockResolvedValue([]);
  dismissUnlockAlerts.mockResolvedValue({ ok: true, data: { dismissed: 1 } });
  // jsdom has no real frame clock; run rAF callbacks synchronously so fake
  // timers only have to drive the setTimeout-based polls below them. jsdom
  // also has no requestIdleCallback, so the component already falls back to
  // a real (fake-timer-controlled) setTimeout for that step.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // A failed assertion mid-test can skip a manually appended `other` dialog's
  // `.remove()`; `cleanup()` only unmounts React trees, so sweep it here too.
  document
    .querySelectorAll('[role="dialog"][data-state="open"]')
    .forEach((node) => node.remove());
});

/**
 * Renders under fake timers and pumps the deferred chain (setTimeout ->
 * splash poll -> stacking poll -> fetch) for `ms`. Stays on fake timers for
 * the rest of the test — switching to real timers mid-test would strand any
 * fake-clock `setTimeout` Radix itself has already scheduled (e.g. the
 * outside-pointerdown listener below), since a real clock never ticks it.
 */
async function openModal(ms = 1000) {
  vi.useFakeTimers();
  render(<UnlockGrantAlerts />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("UnlockGrantAlerts — visibility", () => {
  it("renders nothing when there is nothing to say", async () => {
    fetchUnlockAlerts.mockResolvedValue([]);
    await openModal();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the given title and description", async () => {
    fetchUnlockAlerts.mockResolvedValue(ONE_ALERT);
    await openModal();

    expect(screen.getByText("Monthly reading level reopened.")).toBeTruthy();
    expect(
      screen.getByText("August 2026. Open until September 7, 2026.")
    ).toBeTruthy();
  });
});

describe("UnlockGrantAlerts — closing acknowledges exactly once", () => {
  it("Dismiss calls dismissUnlockAlerts exactly once with every shown id", async () => {
    fetchUnlockAlerts.mockResolvedValue(ONE_ALERT);
    await openModal();
    screen.getByText("Monthly reading level reopened.");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dismissUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(dismissUnlockAlerts).toHaveBeenCalledWith(["alert-1"]);
  });

  it("Escape calls dismissUnlockAlerts exactly once with every shown id", async () => {
    fetchUnlockAlerts.mockResolvedValue(ONE_ALERT);
    await openModal();
    const title = screen.getByText("Monthly reading level reopened.");

    fireEvent.keyDown(title, { key: "Escape" });

    expect(dismissUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(dismissUnlockAlerts).toHaveBeenCalledWith(["alert-1"]);
  });

  it("an overlay click calls dismissUnlockAlerts exactly once with every shown id", async () => {
    fetchUnlockAlerts.mockResolvedValue(ONE_ALERT);
    await openModal();
    screen.getByText("Monthly reading level reopened.");

    // Radix's outside-pointerdown listener attaches on a `setTimeout(0)` (so
    // the opening click itself cannot immediately dismiss it) — let that tick
    // pass before treating the overlay as interactive.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const dialog = screen.getByRole("dialog");
    const overlay = dialog.previousElementSibling as HTMLElement;
    fireEvent.pointerDown(overlay);
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    expect(dismissUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(dismissUnlockAlerts).toHaveBeenCalledWith(["alert-1"]);
  });
});

describe("UnlockGrantAlerts — no stacking with another dialog", () => {
  function openOtherDialog() {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("data-state", "open");
    document.body.appendChild(other);
    return other;
  }

  it("does not open while another dialog is open, and opens once it is removed", async () => {
    fetchUnlockAlerts.mockResolvedValue(ONE_ALERT);
    const other = openOtherDialog();

    vi.useFakeTimers();
    render(<UnlockGrantAlerts />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The fetch itself is not gated on the other dialog — only opening is —
    // so it has already run, but the modal must stay closed while stacked.
    expect(fetchUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Monthly reading level reopened.")).toBeNull();

    other.remove();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Monthly reading level reopened.")).toBeTruthy();
  });

  it("does not open if another dialog appears in the gap between the fetch resolving and the modal opening", async () => {
    let resolveFetch!: (rows: typeof ONE_ALERT) => void;
    fetchUnlockAlerts.mockImplementation(
      () =>
        new Promise<typeof ONE_ALERT>((resolve) => {
          resolveFetch = resolve;
        })
    );

    vi.useFakeTimers();
    render(<UnlockGrantAlerts />);

    // Drive the splash/idle chain up to the fetch call. No dialog exists yet,
    // so a stacking check made BEFORE the fetch (the old, buggy position)
    // would already have passed by this point.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchUnlockAlerts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Resolve the fetch, and in the same synchronous tick — before the
    // component's continuation runs as a microtask — have a sibling dialog
    // (e.g. AralAssignmentAlerts, still finishing its own fetch) appear.
    const other = openOtherDialog();
    resolveFetch(ONE_ALERT);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The fetch has resolved and the alert is known, but the sibling dialog
    // is still open, so the unlock modal must not have opened on top of it.
    expect(screen.queryByText("Monthly reading level reopened.")).toBeNull();

    // Keep polling while the other dialog is up: still must not open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText("Monthly reading level reopened.")).toBeNull();

    other.remove();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(screen.getByText("Monthly reading level reopened.")).toBeTruthy();
  });
});
