import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

afterEach(() => {
  send.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("sendEmail", () => {
  it("returns the provider delivery id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "LITRACK Support <support@arallitrack.com>";
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });
    const { sendEmail } = await import("@/lib/email");

    await expect(sendEmail({ to: ["teacher@example.com"], subject: "Subject", text: "Body" }))
      .resolves.toEqual({ id: "email_123" });
  });

  it("refuses to pretend delivery is available without configuration", async () => {
    const { sendEmail } = await import("@/lib/email");
    await expect(sendEmail({ to: ["teacher@example.com"], subject: "Subject", text: "Body" }))
      .rejects.toThrow("Email is not configured");
  });
});
