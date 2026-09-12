import "server-only";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email";

/**
 * Email an admin when something on our side fails.
 *
 * One email per code per 15 minutes: an outage produces hundreds of identical
 * events, and the first one is the only one that tells anybody anything. With
 * Upstash the window is global; without it, per instance (the documented
 * limitation of the rate limiter), so a duplicate can occasionally slip through.
 *
 * No stack and no personal data in the body — email is the least protected
 * place this information could go. The link leads to the full record.
 */

export type AlertEvent = {
  ref: string;
  code: string;
  route: string | null;
  schoolId: string | null;
  summary: string;
  at: Date;
};

const ALERT_WINDOW = { limit: 1, windowMs: 15 * 60 * 1000 } as const;

let warnedOff = false;

export function alertRecipients(): string[] {
  return (process.env.ERROR_ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendErrorAlert(event: AlertEvent): Promise<void> {
  try {
    const to = alertRecipients();
    if (to.length === 0 || !isEmailConfigured()) {
      if (!warnedOff) {
        warnedOff = true;
        console.warn(
          "[errors] Alert emails are off: set ERROR_ALERT_EMAIL, RESEND_API_KEY and RESEND_FROM_EMAIL to turn them on."
        );
      }
      return;
    }

    const gate = await checkRateLimit(`alert:${event.code}`, ALERT_WINDOW);
    if (!gate.ok) return;

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const link = `${base}/admin/errors?ref=${encodeURIComponent(event.ref)}`;

    await sendEmail({
      to,
      subject: `[LITRACK] ${event.code} — ${event.ref}`,
      text: [
        "LITRACK recorded a server-side failure.",
        "",
        `Code:      ${event.code}`,
        `Reference: ${event.ref}`,
        `When:      ${event.at.toISOString()}`,
        `Where:     ${event.route ?? "unknown"}`,
        `School:    ${event.schoolId ?? "none"}`,
        `Summary:   ${event.summary.split("\n")[0].slice(0, 300)}`,
        "",
        `Full record: ${link}`,
        "",
        "Further failures with this code are not emailed for the next 15 minutes.",
      ].join("\n"),
    });
  } catch (err) {
    console.error("[errors] alert email failed:", err instanceof Error ? err.message : err);
  }
}
