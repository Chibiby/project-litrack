import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

/**
 * Emails a password recovery link built from `origin` — the site the request
 * to reset actually came from — rather than Supabase's `action_link`.
 *
 * `action_link` routes through GoTrue's `/verify` endpoint, which falls back
 * to the project's Site URL whenever `redirectTo` is not on the redirect
 * allowlist, and delivers the session as `#access_token=...` URL-hash tokens
 * that server code never sees. `hashed_token` sidesteps both problems: the
 * link points straight at this app's own `/auth/confirm` route, which reads
 * `token_hash` as a query param and verifies it server-side via
 * `supabase.auth.verifyOtp`. Same shape as the impersonation magic-link flow
 * in `src/lib/actions/accounts.ts`.
 */
export async function sendPasswordRecoveryEmail(email: string, origin: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hashedToken = data.properties?.hashed_token;
  if (error || !hashedToken) throw new Error("Recovery link generation failed");

  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;

  await sendEmail({
    to: [email],
    subject: "Reset your LITRACK password",
    text: `A password reset was requested for your LITRACK account.\n\nReset your password: ${link}\n\nIf you did not request this, you can ignore this email.`,
  });
}
