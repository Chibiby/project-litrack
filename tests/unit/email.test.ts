import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

afterEach(() => {
  send.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("sendEmail", () => {
  it("returns the provider delivery id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "LITRACK Support <support@arallitrack.com>";
    process.env.NEXT_PUBLIC_APP_URL = "https://arallitrack.com";
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });
    const { sendEmail } = await import("@/lib/email");

    await expect(sendEmail({ to: ["teacher@example.com"], subject: "Subject", text: "Body" }))
      .resolves.toEqual({ id: "email_123" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      text: "Body",
      html: expect.stringContaining("https://arallitrack.com/logo.png"),
    }));
  });

  it("escapes message content before placing it in the branded HTML email", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "LITRACK Support <support@arallitrack.com>";
    process.env.NEXT_PUBLIC_APP_URL = "https://arallitrack.com/";
    send.mockResolvedValue({ data: { id: "email_124" }, error: null });
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to: ["teacher@example.com"], subject: "Subject", text: "Hello <script>alert('x')</script>\nNext line" });
    const html = send.mock.calls[0][0].html as string;
    expect(html).toContain("Hello &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;<br>Next line");
    expect(html).not.toContain("<script>");
  });

  it("refuses to pretend delivery is available without configuration", async () => {
    const { sendEmail } = await import("@/lib/email");
    await expect(sendEmail({ to: ["teacher@example.com"], subject: "Subject", text: "Body" }))
      .rejects.toThrow("Email is not configured");
  });
});
