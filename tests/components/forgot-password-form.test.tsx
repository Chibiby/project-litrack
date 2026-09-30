import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Production evidence: 266 reset requests from 126 users, 140 repeats, 97 of
 * those within 10 minutes of the previous one. Supabase keeps one live
 * recovery token per user, so every resend silently invalidates the email
 * already in the person's inbox. This form must make "wait for the one you
 * already have" the obvious next move: disable the resend control for 120s
 * with a visible countdown, and show that same countdown regardless of
 * whether the account actually exists (never an oracle either way).
 *
 * Fake timers are on for the whole suite (needed to drive the countdown
 * deterministically), so assertions flush pending microtasks with `flush()`
 * instead of `waitFor` — `waitFor`'s internal polling uses the real
 * `setTimeout` that fake timers have already replaced, which just times out.
 */

const requestPasswordReset = vi.fn();
vi.mock("@/lib/actions/auth", () => ({
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...(args as [])),
}));

// AppForm's unsaved-changes guard needs a router; the app always provides one.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...(args as [])) },
}));

const { ForgotPasswordForm } = await import("@/components/forms/forgot-password-form");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submitEmail(email: string) {
  fireEvent.input(screen.getByLabelText(/Email/), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  });
  await flush();
}

describe("ForgotPasswordForm — resend cooldown", () => {
  it("shows the check-your-email copy and a disabled, counting-down resend button after a successful submit", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);

    await submitEmail("teacher@example.com");

    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/We sent a reset link\. Check your inbox and spam folder/)
    ).toBeTruthy();

    const resendButton = screen.getByRole("button", { name: /Resend in \d+s/ });
    expect(resendButton).toBeTruthy();
    expect(resendButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Resend in 120s")).toBeTruthy();
  });

  it("counts down and enables Resend once the cooldown elapses", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);
    await submitEmail("teacher@example.com");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Resend in 60s")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    const resendButton = screen.getByRole("button", { name: "Resend" });
    expect(resendButton.hasAttribute("disabled")).toBe(false);
  });

  it("resending calls requestPasswordReset again with the same email and restarts the cooldown", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);
    await submitEmail("teacher@example.com");

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    });
    await flush();

    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
    const [sentForm] = requestPasswordReset.mock.calls[1] as [FormData];
    expect(sentForm.get("email")).toBe("teacher@example.com");
    expect(screen.getByText("Resend in 120s")).toBeTruthy();
  });

  it("a failed resend goes through toastFailure, so a connection code gets its stable toast id", async () => {
    requestPasswordReset.mockResolvedValueOnce({ ok: true });
    render(<ForgotPasswordForm />);
    await submitEmail("teacher@example.com");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    requestPasswordReset.mockResolvedValueOnce({
      ok: false,
      code: "NETWORK_OFFLINE",
      error: "You're offline.",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    });
    await flush();

    expect(toastError).toHaveBeenCalledWith(
      "You're offline.",
      expect.objectContaining({ id: "NETWORK_OFFLINE" })
    );
  });

  it("applies the same cooldown UI whether or not the account exists — requestPasswordReset never distinguishes it", async () => {
    // The action always returns { ok: true } for both an existing and a
    // non-existing account (no enumeration); the form has no other signal to
    // treat them differently, so the countdown always follows a success.
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);

    await submitEmail("no-such-account@example.com");

    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Resend in 120s")).toBeTruthy();
  });
});
