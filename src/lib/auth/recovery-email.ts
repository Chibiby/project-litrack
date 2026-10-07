import "server-only";
import { sendEmail } from "@/lib/email";
import {
  issueResetToken,
  hasRecentResetToken,
  discardResetToken,
} from "@/lib/auth/password-reset";
import { AppError } from "@/lib/errors/app-error";

/**
 * httpOnly cookie that carries the reset token from `/auth/confirm/verify` to
 * `/auth/reset` and `completePasswordReset` (a Server Action posted to the
 * `/auth/reset` page URL), so the token never rides in a URL past
 * `/auth/confirm`. Scoped to `/auth`; lives no longer than the token itself.
 */
export const RESET_COOKIE = "litrack_reset";
export const RESET_COOKIE_PATH = "/auth";

/**
 * Emails a password recovery link built from `origin` (the canonical app URL
 * the caller resolved), pointing at this app's own `/auth/confirm` page.
 *
 * The token is a fresh random value from `issueResetToken`, which also kills
 * every older reset link for this identity — only the newest email works. The
 * database keeps only its sha256, so the raw token exists in this email and
 * nowhere else; it is never logged or audited.
 *
 * The query parameter keeps its historical name `token_hash` (and `type=
 * recovery`) so `/auth/confirm` — a plain, non-consuming GET that mail
 * scanners may prefetch — needs no change. Its value is now the raw token; the
 * verify route hashes it to find the row.
 */
export async function sendPasswordRecoveryEmail(
  email: string,
  origin: string,
  authId: string
): Promise<void> {
  const { token } = await issueResetToken(authId);

  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=recovery`;

  try {
    await sendEmail({
      to: [email],
      subject: "Reset your LITRACK password",
      text: `A password reset was requested for your LITRACK account.\n\nReset your password: ${link}\n\nThis link works once and expires in one hour. If you asked more than once, only the newest email works.\n\nIf you did not request this, you can ignore this email.`,
    });
  } catch (error) {
    // Nothing was delivered, so the token must not linger: a live row would
    // trip the resend cooldown and block the retry the person needs.
    await discardResetToken(token);
    throw new AppError("AUTH_EMAIL_SEND_FAILED", {
      cause: error,
      detail: "Password recovery email delivery failed",
    });
  }
}

/**
 * Whether this identity was already sent a reset link within `withinMs`.
 *
 * Issuing a new link invalidates the previous one, so resending this soon only
 * trades the still-good earlier email (already in the person's inbox) for an
 * identical new one. Best effort: any failure reads as "no recent token", so
 * this check can never block a legitimate reset email from going out.
 */
export async function hasRecentRecoveryToken(authId: string, withinMs: number): Promise<boolean> {
  return hasRecentResetToken(authId, withinMs);
}
