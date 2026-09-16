import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Super Admin's platform-wide "Reset all schools to default" control.
 * Proves the typed-confirmation guard actually gates the destructive action:
 * the confirm button must stay disabled until the admin types the literal
 * string "RESET", and the action must always be called with `{ confirm:
 * "RESET" }` — never with whatever partial text is in the box.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const resetAllSchoolsTermSubjects = vi.fn(async (_input?: unknown) => ({
  ok: true,
  data: { schools: 3, grades: 18, created: 2, restored: 1, archived: 4, failedSchools: 0 },
}));
vi.mock("@/lib/actions/term-subjects", () => ({
  resetAllSchoolsTermSubjects: (...args: unknown[]) =>
    resetAllSchoolsTermSubjects(...(args as [])),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
toastFn.warning = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const { ResetAllSchoolsTermSubjectsButton } = await import(
  "@/components/admin/reset-all-schools-term-subjects-button"
);

beforeEach(() => {
  vi.clearAllMocks();
  resetAllSchoolsTermSubjects.mockResolvedValue({
    ok: true,
    data: { schools: 3, grades: 18, created: 2, restored: 1, archived: 4, failedSchools: 0 },
  });
});

afterEach(cleanup);

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Reset all schools to default" }));
}

describe("ResetAllSchoolsTermSubjectsButton — typed guard", () => {
  it("keeps the confirm button disabled until RESET is typed exactly", async () => {
    render(<ResetAllSchoolsTermSubjectsButton />);
    openDialog();

    const dialog = await screen.findByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Reset all schools" });
    const input = within(dialog).getByLabelText(/Type/);

    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "reset" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "RESE" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "RESET" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);

    expect(resetAllSchoolsTermSubjects).not.toHaveBeenCalled();
  });

  it("calls the action with exactly { confirm: \"RESET\" } once unlocked", async () => {
    render(<ResetAllSchoolsTermSubjectsButton />);
    openDialog();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: "RESET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset all schools" }));

    await waitFor(() => expect(resetAllSchoolsTermSubjects).toHaveBeenCalledTimes(1));
    expect(resetAllSchoolsTermSubjects).toHaveBeenCalledWith({ confirm: "RESET" });

    await waitFor(() => expect(toastFn.success).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("warns about failed schools when failedSchools > 0", async () => {
    resetAllSchoolsTermSubjects.mockResolvedValueOnce({
      ok: true,
      data: { schools: 5, grades: 30, created: 1, restored: 0, archived: 2, failedSchools: 2 },
    });

    render(<ResetAllSchoolsTermSubjectsButton />);
    openDialog();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: "RESET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset all schools" }));

    await waitFor(() => expect(toastFn.warning).toHaveBeenCalledTimes(1));
    expect(toastFn.warning.mock.calls[0][0]).toContain("2 schools");
  });

  it("surfaces res.error via toast.error rather than swallowing it", async () => {
    resetAllSchoolsTermSubjects.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Invalid input",
    } as never);

    render(<ResetAllSchoolsTermSubjectsButton />);
    openDialog();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: "RESET" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset all schools" }));

    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith("Invalid input"));
    expect(toastFn.success).not.toHaveBeenCalled();
  });
});
