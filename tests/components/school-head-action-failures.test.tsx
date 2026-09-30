import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMessage } from "@/lib/errors/codes";

/**
 * A School Head action that fails without a normal result must end in one clear
 * message, with no success toast, the typed input intact and the button usable.
 */

vi.mock("next/navigation", () => ({
  unstable_isUnrecognizedActionError: () => false,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const createGradeLevel = vi.fn();
vi.mock("@/lib/actions/school-head", () => ({
  createGradeLevel: (...args: unknown[]) => createGradeLevel(...args),
}));

const updateSchoolInfo = vi.fn();
vi.mock("@/lib/actions/school-management", () => ({
  updateSchoolInfo: (...args: unknown[]) => updateSchoolInfo(...args),
}));

const { CreateGradeLevelButton } = await import(
  "@/components/school-head/create-grade-level-button"
);
const { SchoolInfoForm } = await import("@/components/school-head/school-info-form");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("CreateGradeLevelButton — failure", () => {
  it("shows the failure and no success toast when the action returns an ActionFailure", async () => {
    createGradeLevel.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Complete your profile first.",
    });

    render(<CreateGradeLevelButton type="G3" label="Grade 3" />);
    const button = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toBe("Complete your profile first.");
    expect(toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});

describe("SchoolInfoForm — unreachable server", () => {
  it("shows SERVER_UNREACHABLE once and keeps what was typed when the action rejects", async () => {
    updateSchoolInfo.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <SchoolInfoForm
        school={{
          name: "Rizal ES",
          schoolIdCode: "123456",
          address: null,
          region: null,
          division: null,
          district: null,
        }}
      />
    );

    const name = screen.getByLabelText("School name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Rizal Elementary School" } });
    const save = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(save);
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toBe(formatMessage("SERVER_UNREACHABLE"));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(name.value).toBe("Rizal Elementary School");
    await waitFor(() => expect(save.disabled).toBe(false));
  });
});
