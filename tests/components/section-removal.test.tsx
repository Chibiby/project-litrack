import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const deleteSection = vi.fn();
vi.mock("@/lib/actions/section", () => ({
  createSection: vi.fn(),
  createNextLetterSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: (...args: unknown[]) => deleteSection(...args),
}));

const { GradeSectionsPanel } = await import("@/components/school-head/section-forms");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const SECTIONS = [
  { id: "s1", name: "Sampaguita", learnerCount: 12 },
  { id: "s2", name: "Rosal", learnerCount: 0 },
];

describe("GradeSectionsPanel — removing a section", () => {
  it("disables Remove for a section with learners and says why on screen", () => {
    render(<GradeSectionsPanel gradeLevelId="g1" sections={SECTIONS} />);

    const buttons = screen.getAllByRole("button", { name: "Remove" });
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);

    const reason = screen.getByText("Move its 12 learners to another section first");
    expect(reason).toBeTruthy();
    expect(buttons[0].getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("says an empty section is hidden from teachers and its advisers are unassigned", async () => {
    render(<GradeSectionsPanel gradeLevelId="g1" sections={SECTIONS} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("hidden from teachers");
    expect(dialog.textContent).toContain("adviser assigned to it is unassigned");
  });

  it("toasts the server refusal, keeps the dialog open and puts the row back", async () => {
    deleteSection.mockResolvedValueOnce({
      ok: false,
      code: "SECTION_HAS_LEARNERS",
      error: "Move the 3 learners in Rosal to another section first.",
    });
    render(<GradeSectionsPanel gradeLevelId="g1" sections={SECTIONS} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Move the 3 learners in Rosal to another section first.",
        undefined
      )
    );
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getAllByLabelText("Section name") as HTMLInputElement[]).map((i) => i.value)
      ).toEqual(["Sampaguita", "Rosal"])
    );
  });
});
