import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("@/lib/actions/learner", () => ({
  archiveLearner: vi.fn(),
  restoreLearner: vi.fn(),
}));
vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LearnerArchiveButton } = await import("@/components/learners/learner-archive-button");

afterEach(cleanup);

describe("profile-page archive confirm", () => {
  it("uses the same wording as the roster, with the ARAL line for an ARAL learner", async () => {
    render(
      <LearnerArchiveButton learnerId="l1" learnerName="Ana Santos" isAralLearner archived={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Remove Ana Santos?")).toBeTruthy();
    expect(alert.textContent).toContain("restore them from Removed for 30 days");
    expect(alert.textContent).toContain("leaves the ARAL weekly grids");
    expect(within(alert).getByRole("button", { name: "Yes, remove" })).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "No" })).toBeTruthy();
  });

  it("leaves the ARAL line out for a learner who is not in ARAL", async () => {
    render(<LearnerArchiveButton learnerId="l1" learnerName="Ana Santos" archived={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const alert = await screen.findByRole("alertdialog");
    expect(alert.textContent).not.toContain("ARAL");
  });
});
