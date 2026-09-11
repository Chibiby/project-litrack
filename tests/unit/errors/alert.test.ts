import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The alert email is the one place error detail leaves the system, so what it
 * must NOT carry is as load-bearing as what it does: no stack, no personal
 * data, and never more than one per code per window — an outage produces
 * hundreds of identical events and would otherwise bury the inbox it is meant
 * to warn.
 */

const sendEmail = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  get sendEmail() {
    return sendEmail;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
}));

import { alertRecipients, sendErrorAlert } from "@/lib/errors/alert";

const EVENT = {
  ref: "E-7K2P9QXM",
  code: "DB_UNAVAILABLE",
  route: "saveSection",
  schoolId: "school-1",
  summary: "P2024 Timed out fetching a new connection from the connection pool",
  at: new Date("2026-09-11T02:00:00Z"),
};

const ENV_KEYS = [
  "ERROR_ALERT_EMAIL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "NEXT_PUBLIC_APP_URL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ERROR_ALERT_EMAIL = "ops@example.org, lead@example.org";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "LITRACK <noreply@example.org>";
  process.env.NEXT_PUBLIC_APP_URL = "https://litrack.example.org";
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  sendEmail.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sendErrorAlert", () => {
  it("splits the recipient list", () => {
    expect(alertRecipients()).toEqual(["ops@example.org", "lead@example.org"]);
  });

  it("emails the code, reference and a deep link — and no stack", async () => {
    await sendErrorAlert(EVENT);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["ops@example.org", "lead@example.org"]);
    expect(mail.subject).toContain("DB_UNAVAILABLE");
    expect(mail.subject).toContain("E-7K2P9QXM");
    expect(mail.text).toContain("https://litrack.example.org/admin/errors?ref=E-7K2P9QXM");
    expect(mail.text).not.toMatch(/\n\s+at /);
  });

  it("throttles per code", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });
    await sendErrorAlert(EVENT);
    expect(checkRateLimit).toHaveBeenCalledWith(
      "alert:DB_UNAVAILABLE",
      expect.objectContaining({ limit: 1 })
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stays off without a recipient or a sender", async () => {
    delete process.env.ERROR_ALERT_EMAIL;
    await sendErrorAlert(EVENT);
    process.env.ERROR_ALERT_EMAIL = "ops@example.org";
    delete process.env.RESEND_API_KEY;
    await sendErrorAlert(EVENT);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never throws when the email provider fails", async () => {
    sendEmail.mockRejectedValue(new Error("Resend 500"));
    await expect(sendErrorAlert(EVENT)).resolves.toBeUndefined();
  });
});
