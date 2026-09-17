import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test Lab dry run (docs/test-lab-spec.md T6): the change-password form shows
 * the amber notice, a dry-run success opens a preview instead of the
 * "Password updated" toast, and the typed password is never rendered.
 */

const changePasswordAction = vi.fn();
const setPasswordAction = vi.fn();
const skipPasswordChange = vi.fn();
const completePasswordReset = vi.fn();
vi.mock("@/lib/actions/auth", () => ({
  changePasswordAction: (...args: unknown[]) => changePasswordAction(...(args as [])),
  setPasswordAction: (...args: unknown[]) => setPasswordAction(...(args as [])),
  skipPasswordChange: (...args: unknown[]) => skipPasswordChange(...(args as [])),
  completePasswordReset: (...args: unknown[]) => completePasswordReset(...(args as [])),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...(args as [])),
    error: (...args: unknown[]) => toastError(...(args as [])),
  },
}));

const { PasswordForm } = await import("@/components/forms/password-form");

const VALID_CHANGE = {
  currentPassword: "OldPass1",
  password: "NewPass123",
  confirmPassword: "NewPass123",
};

async function fillChangeForm() {
  fireEvent.input(screen.getByLabelText(/Current password/), {
    target: { value: VALID_CHANGE.currentPassword },
  });
  fireEvent.input(screen.getByLabelText(/^New password/), {
    target: { value: VALID_CHANGE.password },
  });
  fireEvent.input(screen.getByLabelText(/Confirm new password/), {
    target: { value: VALID_CHANGE.confirmPassword },
  });
}

const DRY_RUN_RESULT = {
  ok: true as const,
  data: { dryRun: true as const, preview: { validated: true as const, changed: false as const } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("change password — Test Lab dry run", () => {
  it("shows the amber notice when dryRun is set", () => {
    render(<PasswordForm mode="change" dryRun />);
    expect(screen.getByText("Test Lab")).toBeTruthy();
  });

  it("does not show the notice outside a Test Lab session", () => {
    render(<PasswordForm mode="change" />);
    expect(screen.queryByText("Test Lab")).toBeNull();
  });

  it("opens a preview instead of toasting 'updated' on a dry-run success, and never renders the password", async () => {
    changePasswordAction.mockResolvedValue(DRY_RUN_RESULT);

    render(<PasswordForm mode="change" dryRun />);
    await fillChangeForm();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(changePasswordAction).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("The password meets the rules. Nothing was changed.")).toBeTruthy(),
    );

    expect(toastSuccess).not.toHaveBeenCalledWith("Password updated");
    expect(screen.queryByText(VALID_CHANGE.password)).toBeNull();
    expect(screen.queryByDisplayValue(VALID_CHANGE.password)).toBeNull();
  });

  it("updates normally and toasts success when the result carries no dryRun flag", async () => {
    changePasswordAction.mockResolvedValue({ ok: true });

    render(<PasswordForm mode="change" />);
    await fillChangeForm();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(changePasswordAction).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Password updated"));
    expect(
      screen.queryByText("The password meets the rules. Nothing was changed."),
    ).toBeNull();
  });
});
