import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const setActiveSchoolYear = vi.fn();
vi.mock("@/lib/actions/school-year", () => ({
  createSchoolYear: vi.fn(),
  updateSchoolYear: vi.fn(),
  deleteSchoolYear: vi.fn(),
  setActiveSchoolYear: (...args: unknown[]) => setActiveSchoolYear(...args),
}));

const { SchoolYearsList } = await import("@/components/school-head/school-year-forms");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const YEARS = [
  {
    id: "y1",
    label: "2025-2026",
    startDate: "2025-06-01",
    endDate: "2026-03-31",
    isActive: true,
    enrollmentCount: 10,
    termGradeCount: 0,
  },
  {
    id: "y2",
    label: "2026-2027",
    startDate: "2026-06-01",
    endDate: "2027-03-31",
    isActive: false,
    enrollmentCount: 0,
    termGradeCount: 0,
  },
];

describe("SchoolYearsList — set active", () => {
  it("asks first and does not call the action until confirmed", async () => {
    render(<SchoolYearsList years={YEARS} />);

    fireEvent.click(screen.getByRole("button", { name: "Set active" }));
    const dialog = await screen.findByRole("alertdialog");

    expect(within(dialog).getByText("Make 2026-2027 active?")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "2025-2026 stops being active. New enrolments go to 2026-2027. You can switch back."
    );
    expect(setActiveSchoolYear).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Make 2026-2027 active" })).toBeTruthy();
  });

  it("switches the year after confirming", async () => {
    setActiveSchoolYear.mockResolvedValueOnce({ ok: true });
    render(<SchoolYearsList years={YEARS} />);

    fireEvent.click(screen.getByRole("button", { name: "Set active" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make 2026-2027 active" }));

    await waitFor(() => expect(setActiveSchoolYear).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastFn.success).toHaveBeenCalledWith("Active school year updated")
    );
  });

  it("keeps the dialog open and toasts the failure", async () => {
    setActiveSchoolYear.mockResolvedValueOnce({
      ok: false,
      code: "DB_UNAVAILABLE",
      error: "Couldn't switch the school year.",
    });
    render(<SchoolYearsList years={YEARS} />);

    fireEvent.click(screen.getByRole("button", { name: "Set active" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make 2026-2027 active" }));

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Couldn't switch the school year.", {
        id: "DB_UNAVAILABLE",
      })
    );
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
