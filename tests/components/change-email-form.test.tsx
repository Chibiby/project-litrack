import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const changeEmailAction = vi.fn(async (_fd: FormData): Promise<unknown> => ({ ok: true, data: {} }));
vi.mock("@/lib/actions/auth", () => ({
  changeEmailAction: (fd: FormData) => changeEmailAction(fd),
}));

const { ChangeEmailForm } = await import("@/components/forms/change-email-form");

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/^New email/), { target: { value: "new@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Confirm new email/), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: "Password123!" } });
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
}

describe("ChangeEmailForm confirmation", () => {
  it("shows old -> new and sign-in consequence before calling the action", async () => {
    render(<ChangeEmailForm currentEmail="old@example.com" isSynthetic={false} />);
    fillAndSubmit();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/old@example\.com → new@example\.com/)).not.toBeNull();
    expect(within(dialog).getByText(/You'll sign in with new@example\.com from now on/)).not.toBeNull();
    expect(within(dialog).getByText(/No confirmation email is sent/)).not.toBeNull();
    expect(changeEmailAction).not.toHaveBeenCalled();
  });

  it("cancel never calls the action and keeps the typed values", async () => {
    render(<ChangeEmailForm currentEmail="old@example.com" isSynthetic={false} />);
    fillAndSubmit();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(changeEmailAction).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^New email/) as HTMLInputElement).value).toBe("new@example.com");
  });

  it("confirming calls the action, and a failure keeps the input", async () => {
    changeEmailAction.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "That email is already in use",
    });
    render(<ChangeEmailForm currentEmail="old@example.com" isSynthetic={false} />);
    fillAndSubmit();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change email" }));

    await waitFor(() => expect(changeEmailAction).toHaveBeenCalledTimes(1));
    await screen.findByText("That email is already in use");
    expect((screen.getByLabelText(/^New email/) as HTMLInputElement).value).toBe("new@example.com");
  });
});
