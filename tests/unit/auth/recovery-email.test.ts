import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendPasswordRecoveryEmail` used to email Supabase's own `action_link`,
 * which routes through GoTrue's `/verify` endpoint — falling back to the
 * project's Site URL (localhost in prod) whenever `redirectTo` isn't
 * allowlisted, and delivering the session as `#access_token=...` hash
 * fragments no server code can read. It now builds the link itself from
 * `hashed_token` and the caller-supplied site origin, pointing at this app's
 * own `/auth/confirm` route. Pinned here so a revert (going back to
 * `action_link`) fails loudly.
 */

const { generateLink, sendEmail } = vi.hoisted(() => ({ generateLink: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ auth: { admin: { generateLink } } }) }));
vi.mock("@/lib/email", () => ({ sendEmail }));

import { sendPasswordRecoveryEmail } from "@/lib/auth/recovery-email";

beforeEach(() => {
  generateLink.mockReset().mockResolvedValue({
    data: {
      properties: {
        hashed_token: "hashed-token-value",
        // Present on a real Supabase response — must never be what gets
        // emailed, even though it's still on the payload.
        action_link: "https://auth.example/verify?type=recovery&token=secret#access_token=x",
      },
    },
    error: null,
  });
  sendEmail.mockReset().mockResolvedValue({ id: "delivery" });
});

describe("sendPasswordRecoveryEmail", () => {
  it("builds the /auth/confirm?token_hash=...&type=recovery link on the given origin", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com");

    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "teacher@example.com" });

    const [sent] = sendEmail.mock.calls[0];
    expect(sent.to).toEqual(["teacher@example.com"]);
    expect(sent.text).toContain(
      "https://arallitrack.com/auth/confirm?token_hash=hashed-token-value&type=recovery"
    );
  });

  it("never sends Supabase's action_link, even when present on the response", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com");

    const [sent] = sendEmail.mock.calls[0];
    expect(sent.text).not.toContain("auth.example");
    expect(sent.text).not.toContain("access_token");
  });

  it("strips no trailing slash handling burden onto the origin — encodes the token", async () => {
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "needs encoding/slash" } },
      error: null,
    });

    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com");

    const [sent] = sendEmail.mock.calls[0];
    expect(sent.text).toContain(`token_hash=${encodeURIComponent("needs encoding/slash")}`);
  });

  it("does not send when Supabase cannot produce a hashed_token", async () => {
    generateLink.mockResolvedValue({ data: { properties: {} }, error: { message: "failed" } });
    await expect(
      sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com")
    ).rejects.toThrow("Recovery link generation failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when hashed_token is missing even without an error", async () => {
    generateLink.mockResolvedValue({ data: { properties: { action_link: "https://x" } }, error: null });
    await expect(
      sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com")
    ).rejects.toThrow("Recovery link generation failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
