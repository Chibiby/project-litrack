import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateLink, sendEmail } = vi.hoisted(() => ({ generateLink: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ auth: { admin: { generateLink } } }) }));
vi.mock("@/lib/email", () => ({ sendEmail }));

import { sendPasswordRecoveryEmail } from "@/lib/auth/recovery-email";

beforeEach(() => {
  generateLink.mockReset().mockResolvedValue({ data: { properties: { action_link: "https://auth.example/recover?token=secret" } }, error: null });
  sendEmail.mockReset().mockResolvedValue({ id: "delivery" });
});

describe("sendPasswordRecoveryEmail", () => {
  it("generates a recovery link and sends it through the shared support sender", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com/auth/reset");
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "teacher@example.com", options: { redirectTo: "https://arallitrack.com/auth/reset" } });
    expect(sendEmail).toHaveBeenCalledWith({
      to: ["teacher@example.com"],
      subject: "Reset your LITRACK password",
      text: expect.stringContaining("https://auth.example/recover?token=secret"),
    });
  });

  it("does not send when Supabase cannot produce a recovery link", async () => {
    generateLink.mockResolvedValue({ data: { properties: {} }, error: { message: "failed" } });
    await expect(sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com/auth/reset")).rejects.toThrow("Recovery link generation failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
