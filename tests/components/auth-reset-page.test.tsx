import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { peekResetToken, cookieGet } = vi.hoisted(() => ({
  peekResetToken: vi.fn(),
  cookieGet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
vi.mock("@/lib/auth/password-reset", () => ({ peekResetToken }));
vi.mock("@/components/forms/password-form", () => ({
  PasswordForm: ({ mode }: { mode: string }) => <div data-testid="password-form">{mode}</div>,
}));

import AuthResetPage from "@/app/auth/reset/page";

beforeEach(() => {
  peekResetToken.mockReset().mockResolvedValue(null);
  cookieGet.mockReset().mockReturnValue(undefined);
});

afterEach(cleanup);

async function renderPage(params: Record<string, string>) {
  const ui = await AuthResetPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

describe("/auth/reset error state", () => {
  it("never renders text taken from the URL", async () => {
    const { container } = await renderPage({ error_description: "<script>x</script> Fake support: call 555" });
    expect(container.innerHTML).not.toContain("script");
    expect(container.textContent).not.toContain("Fake support");
    expect(container.textContent).toContain("Request a new reset link");
  });

  it("shows the fixed expired sentence for an expired link", async () => {
    const { container } = await renderPage({ error: "access_denied", error_code: "otp_expired" });
    expect(container.textContent).toContain("expired or was already used");
  });
});

describe("/auth/reset reset-cookie gate", () => {
  it("shows the password form when the litrack_reset cookie holds a live token", async () => {
    cookieGet.mockReturnValue({ value: "live-token" });
    peekResetToken.mockResolvedValue({ authId: "auth-1", expiresAt: new Date(Date.now() + 60_000) });

    const { getByTestId, container } = await renderPage({});

    expect(cookieGet).toHaveBeenCalledWith("litrack_reset");
    expect(peekResetToken).toHaveBeenCalledWith("live-token");
    expect(getByTestId("password-form").textContent).toBe("reset");
    expect(container.textContent).not.toContain("Request a new reset link");
  });

  it("asks the person to open the emailed link when there is no cookie, without touching the store", async () => {
    const { container } = await renderPage({});

    expect(peekResetToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Open the link from your email to continue");
    expect(container.textContent).toContain("Request a new reset link");
  });

  it("does not show the form when the cookie token is dead", async () => {
    cookieGet.mockReturnValue({ value: "spent-token" });
    peekResetToken.mockResolvedValue(null);

    const { queryByTestId, container } = await renderPage({});

    expect(queryByTestId("password-form")).toBeNull();
    expect(container.textContent).toContain("Request a new reset link");
  });

  it("falls back to a safe message when the token store throws", async () => {
    cookieGet.mockReturnValue({ value: "live-token" });
    peekResetToken.mockRejectedValue(new Error("connection refused: postgres://secret"));

    const { container, queryByTestId } = await renderPage({});

    expect(queryByTestId("password-form")).toBeNull();
    expect(container.textContent).toContain("Unable to start password reset");
    expect(container.textContent).not.toContain("postgres");
  });
});
