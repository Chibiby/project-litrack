import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ARAL assignment modal with many alerts. Assigning learners one at a time
 * writes one alert each, so a teacher can come back to a dozen or more. They
 * must group under one heading per person, and the list must scroll inside a
 * dialog capped to the viewport instead of running off the screen.
 */

vi.mock("@/lib/post-login-flag", () => ({
  isPostLoginLoadingCover: () => false,
}));

const fetchAralAssignmentAlerts = vi.fn();
vi.mock("@/lib/actions/notifications", () => ({
  fetchAralAssignmentAlerts: () => fetchAralAssignmentAlerts(),
  dismissAralAssignmentAlerts: vi.fn().mockResolvedValue({ ok: true, data: { dismissed: 0 } }),
}));

import { AralAssignmentAlerts } from "@/components/notifications/aral-assignment-alerts";

function alert(i: number, actorName: string) {
  return {
    id: `alert-${i}`,
    title: `${actorName} assigned you an ARAL learner.`,
    description: `Learner ${i}`,
    href: "/teacher/aral?grade=g1",
    actorName,
    count: 1,
  };
}

beforeEach(() => {
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
});

async function openModal() {
  vi.useFakeTimers();
  render(<AralAssignmentAlerts />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("AralAssignmentAlerts with many alerts", () => {
  it("groups alerts from one person under a single heading with the total", async () => {
    fetchAralAssignmentAlerts.mockResolvedValue([
      ...Array.from({ length: 14 }, (_, i) => alert(i, "Teacher Ann Mae Lapitan")),
      alert(99, "School Head Rosa Diaz"),
    ]);
    await openModal();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getAllByText(/assigned you/).map((n) => n.textContent)
    ).toEqual([
      "Teacher Ann Mae Lapitan assigned you 14 ARAL learners.",
      "School Head Rosa Diaz assigned you an ARAL learner.",
    ]);
    expect(within(dialog).getByText("Learner 0")).toBeTruthy();
    expect(within(dialog).getByText("Learner 13")).toBeTruthy();
    expect(within(dialog).getByText("Learner 99")).toBeTruthy();
  });

  it("caps the dialog height and scrolls the list inside it", async () => {
    fetchAralAssignmentAlerts.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => alert(i, "Teacher Ann Mae Lapitan"))
    );
    await openModal();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[85dvh]");
    const list = within(dialog).getByLabelText("New ARAL learners");
    expect(list.className).toContain("overflow-y-auto");
    // The buttons sit outside the scrolling list, so they stay on screen.
    expect(within(list).queryByRole("button")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
