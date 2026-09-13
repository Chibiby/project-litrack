import "server-only";
import { Resend } from "resend";

/**
 * The one place LITRACK sends email through Resend. Reads env directly rather
 * than through `getServerEnv`, so a half-configured deployment degrades to
 * "email off" instead of throwing inside an error path.
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function brandedHtml(text: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://arallitrack.com").replace(/\/$/, "");
  const message = escapeHtml(text).replaceAll("\n", "<br>");
  return `<!doctype html>
<html><body style="margin:0;background:#f5f3ff;font-family:Arial,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f5f3ff"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #ede9fe"><img src="${baseUrl}/logo.png" width="120" alt="LITRACK" style="display:block;max-width:120px;height:auto"></td></tr>
      <tr><td style="padding:28px;font-size:15px;line-height:1.7">${message}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #ede9fe;color:#6b7280;font-size:12px">LITRACK · ARAL learner tracking and support</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    throw new Error("Email is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)");
  }

  const { data, error } = await new Resend(key).emails.send({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: brandedHtml(input.text),
  });
  if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
  return { id: data?.id ?? null };
}
