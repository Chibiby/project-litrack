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
  });
  if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
  return { id: data?.id ?? null };
}
