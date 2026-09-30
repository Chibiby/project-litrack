import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";

/**
 * Closing the Add learner dialog with edits in the form asks first, by every
 * route (Escape, overlay, X, Cancel). A clean form closes without a question.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));
vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));
vi.mock("@/lib/actions/learner", () => ({
  createLearner: vi.fn(),
  updateLearner: vi.fn(),
}));

const { AddLearnerDialog } = await import("@/components/learners/add-learner-dialog");

const PLACEMENTS: AdvisoryPlacement[] = [
  {
    sectionId: "sec-1",
    sectionName: "Sampaguita",
    gradeLevelId: "grade-g3",
    gradeType: "G3",
    gradeLabel: "Grade 3",
    label: "Grade 3 · Sampaguita",
  },
];

async function openForm() {
  render(<AddLearnerDialog placements={PLACEMENTS} />);
  fireEvent.click(screen.getByRole("button", { name: "Add new learner" }));
  fireEvent.click(await screen.findByRole("button", { name: "Next: learner details" }));
  return (await screen.findByLabelText("First name *", {}, { timeout: 10_000 })) as HTMLInputElement;
}

// The form reads typing from the native `input` event, which `fireEvent.change` never fires.
const type = (el: HTMLInputElement, value: string) =>
  fireEvent.input(el, { target: { value } });

afterEach(cleanup);

describe("Add learner dialog — unsaved changes", () => {
  it("closes without a question while the form is untouched", async () => {
    await openForm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  }, 15_000);

  it("asks before Escape discards typed edits, and Keep editing preserves them", async () => {
    const first = await openForm();
    type(first, "Juan");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Discard changes?")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((screen.getByLabelText("First name *") as HTMLInputElement).value).toBe("Juan");
  }, 15_000);

  it("closes only after Discard changes is chosen on Cancel", async () => {
    const first = await openForm();
    type(first, "Juan");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const alert = await screen.findByRole("alertdialog");
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 15_000);

  it("treats typing and then clearing the field as clean", async () => {
    const first = await openForm();
    type(first, "Juan");
    type(first, "");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  }, 15_000);
});
