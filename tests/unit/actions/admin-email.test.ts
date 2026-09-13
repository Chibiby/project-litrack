import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, checkRateLimit, sendEmail, writeAudit } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  checkRateLimit: vi.fn(),
  sendEmail: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail }));
vi.mock("@/lib/errors/report", () => ({ reportError: () => "E-TEST" }));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-actions")>("@/lib/audit-actions");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit };
});
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));

import { sendAdminEmail } from "@/lib/actions/admin-email";

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
  checkRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfterMs: 0 });
  sendEmail.mockReset().mockResolvedValue({ id: "sent" });
  writeAudit.mockReset().mockResolvedValue(undefined);
});

describe("sendAdminEmail", () => {
  it("delivers a separate private copy and audits only aggregate counts", async () => {
    const result = await sendAdminEmail({ recipients: ["A@example.com", "b@example.com"], subject: "Notice", body: "Please review." });
    expect(result).toEqual({ ok: true, data: { sent: 2, failed: [] } });
    expect(sendEmail.mock.calls.map(([input]) => input.to)).toEqual([["a@example.com"], ["b@example.com"]]);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "ADMIN_EMAIL_SEND",
      metadata: { recipientCount: 2, sentCount: 2, failedCount: 0 },
    }));
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("Notice");
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("example.com");
  });

  it("continues after one recipient fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider detail")).mockResolvedValueOnce({ id: "sent" });
    const result = await sendAdminEmail({ recipients: ["a@example.com", "b@example.com"], subject: "Notice", body: "Message" });
    expect(result).toEqual({ ok: true, data: { sent: 1, failed: [{ email: "a@example.com", error: "Delivery failed" }] } });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("refuses a non-admin before delivery", async () => {
    requireUser.mockResolvedValue({ id: "teacher", role: "TEACHER" });
    const result = await sendAdminEmail({ recipients: ["a@example.com"], subject: "Notice", body: "Message" });
    expect(result).toMatchObject({ ok: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
