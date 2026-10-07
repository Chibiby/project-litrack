import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendPasswordRecoveryEmail` builds the link itself, from a random token it
 * got from `issueResetToken`, and points it at this app's own `/auth/confirm`
 * page on the caller-supplied origin. Pinned here:
 *  - the token goes into the email and nowhere else (not the audit, not a log);
 *  - issuing happens first and for the right identity, so older links die;
 *  - nothing is sent when no token could be issued;
 *  - the copy tells the truth: one use, one hour, newest email wins;
 *  - no Supabase artifact (`action_link`, `#access_token`) can reappear.
 * This replaces the Supabase-era test of the same name in tests/unit/auth/
 * (deleted by T14).
 */

const { issueResetToken, hasRecentResetToken, discardResetToken, sendEmail } = vi.hoisted(() => ({
  issueResetToken: vi.fn(),
  hasRecentResetToken: vi.fn(),
  discardResetToken: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/auth/password-reset", () => ({ issueResetToken, hasRecentResetToken, discardResetToken }));
vi.mock("@/lib/email", () => ({ sendEmail }));

import {
  RESET_COOKIE,
  RESET_COOKIE_PATH,
  hasRecentRecoveryToken,
  sendPasswordRecoveryEmail,
} from "@/lib/auth/recovery-email";

const AUTH_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

beforeEach(() => {
  issueResetToken.mockReset().mockResolvedValue({ token: TOKEN, expiresAt: new Date() });
  hasRecentResetToken.mockReset();
  discardResetToken.mockReset().mockResolvedValue(undefined);
  sendEmail.mockReset().mockResolvedValue({ id: "delivery" });
});

describe("sendPasswordRecoveryEmail", () => {
  it("builds the /auth/confirm?token_hash=...&type=recovery link on the given origin", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);

    const [sent] = sendEmail.mock.calls[0];
    expect(sent.to).toEqual(["teacher@example.com"]);
    expect(sent.subject).toBe("Reset your LITRACK password");
    expect(sent.text).toContain(
      `https://arallitrack.com/auth/confirm?token_hash=${TOKEN}&type=recovery`
    );
  });

  it("issues the token for the identity it was given, before anything is sent", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);

    expect(issueResetToken).toHaveBeenCalledTimes(1);
    expect(issueResetToken).toHaveBeenCalledWith(AUTH_ID);
    expect(issueResetToken.mock.invocationCallOrder[0]).toBeLessThan(
      sendEmail.mock.invocationCallOrder[0]
    );
  });

  it("uses the origin as given, whatever it is, rather than reading one from anywhere else", async () => {
    await sendPasswordRecoveryEmail("t@example.com", "http://localhost:3000", AUTH_ID);
    expect(sendEmail.mock.calls[0][0].text).toContain("http://localhost:3000/auth/confirm?token_hash=");
  });

  it("percent-encodes the token in the query string", async () => {
    issueResetToken.mockResolvedValue({ token: "needs encoding/slash+plus", expiresAt: new Date() });

    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);

    expect(sendEmail.mock.calls[0][0].text).toContain(
      `token_hash=${encodeURIComponent("needs encoding/slash+plus")}&type=recovery`
    );
  });

  it("emails the link exactly once, to exactly one recipient", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(["teacher@example.com"]);
  });

  it("carries no Supabase artifact: no action_link, no hash-fragment tokens, no auth host", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);

    const { text } = sendEmail.mock.calls[0][0];
    expect(text).not.toContain("supabase");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("#");
    expect(text).not.toContain("/auth/v1/verify");
  });

  it("does not send when no token could be issued, and lets the caller see the failure", async () => {
    issueResetToken.mockRejectedValue(new Error("connection refused"));

    await expect(
      sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID)
    ).rejects.toThrow("connection refused");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("lets a mail-provider failure reach the caller as AUTH_EMAIL_SEND_FAILED, with the provider error as cause", async () => {
    const providerError = new Error("resend 500");
    sendEmail.mockRejectedValue(providerError);

    const err = await sendPasswordRecoveryEmail(
      "teacher@example.com",
      "https://arallitrack.com",
      AUTH_ID
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "AppError", code: "AUTH_EMAIL_SEND_FAILED" });
    expect((err as Error).cause).toBe(providerError);
    // The user-facing message never carries the provider's text.
    expect((err as Error).message).not.toContain("resend 500");
  });

  it("deletes the issued token when the email fails, and never reports success", async () => {
    sendEmail.mockRejectedValue(new Error("resend 500"));

    await expect(
      sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID)
    ).rejects.toMatchObject({ code: "AUTH_EMAIL_SEND_FAILED" });

    // The row of the link nobody received is removed, so the resend cooldown
    // does not block the retry.
    expect(discardResetToken).toHaveBeenCalledTimes(1);
    expect(discardResetToken).toHaveBeenCalledWith(TOKEN);
    expect(discardResetToken.mock.invocationCallOrder[0]).toBeGreaterThan(
      sendEmail.mock.invocationCallOrder[0]
    );
  });

  it("does not discard the token when the email was delivered", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);
    expect(discardResetToken).not.toHaveBeenCalled();
  });


  it("says the link works once, expires in one hour, and only the newest email works", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);

    const { text } = sendEmail.mock.calls[0][0];
    expect(text).toContain(
      "This link works once and expires in one hour. If you asked more than once, only the newest email works."
    );
  });

  it("tells a person who did not ask that they can ignore the email", async () => {
    await sendPasswordRecoveryEmail("teacher@example.com", "https://arallitrack.com", AUTH_ID);
    expect(sendEmail.mock.calls[0][0].text).toContain("If you did not request this, you can ignore this email.");
  });
});

describe("reset cookie contract", () => {
  it("names the httpOnly cookie that carries the token past /auth/confirm, scoped to /auth", () => {
    expect(RESET_COOKIE).toBe("litrack_reset");
    expect(RESET_COOKIE_PATH).toBe("/auth");
  });
});

describe("hasRecentRecoveryToken", () => {
  const WINDOW = 2 * 60 * 1000;

  it("delegates to hasRecentResetToken with the same identity and window", async () => {
    hasRecentResetToken.mockResolvedValue(true);
    await expect(hasRecentRecoveryToken(AUTH_ID, WINDOW)).resolves.toBe(true);
    expect(hasRecentResetToken).toHaveBeenCalledWith(AUTH_ID, WINDOW);
  });

  it("returns false when there is no recent token", async () => {
    hasRecentResetToken.mockResolvedValue(false);
    await expect(hasRecentRecoveryToken(AUTH_ID, WINDOW)).resolves.toBe(false);
  });
});
