import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AuthResetPage from "@/app/auth/reset/page";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/components/forms/password-form", () => ({ PasswordForm: () => null }));

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
