import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

/**
 * Emails a password recovery link built from `origin` — the site the request
 * to reset actually came from — rather than Supabase's `action_link`.
 *
 * `action_link` routes through GoTrue's `/verify` endpoint, which falls back
 * to the project's Site URL whenever `redirectTo` is not on the redirect
 * allowlist, and delivers the session as `#access_token=...` URL-hash tokens
 * that server code never sees. `hashed_token` sidesteps both problems: the
 * link points straight at this app's own `/auth/confirm` page, which lands a
 * plain (non-consuming) GET and hands the token to a POST route handler —
 * see `src/app/auth/confirm/verify/route.ts` — for the actual
 * `supabase.auth.verifyOtp` exchange. Same link shape as the impersonation
 * magic-link flow in `src/lib/actions/accounts.ts`.
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
    text: `A password reset was requested for your LITRACK account.\n\nReset your password: ${link}\n\nThis link works once and expires soon. If you asked more than once, only the newest email works.\n\nIf you did not request this, you can ignore this email.`,
  });
}

/**
 * Best-effort check for whether this Supabase user already has a recovery
 * token younger than `withinMs`.
 *
 * Supabase keeps exactly one live recovery token per user — each new
 * `generateLink` call invalidates the previous email's link. Production data
 * showed most resends land within a few minutes of the last one, so sending
 * again this soon only trades the still-good earlier email for an identical
 * new one, at the cost of the earlier link (already in the person's inbox)
 * silently going dead. `auth.one_time_tokens` is GoTrue's own table, reached
 * here only to read a timestamp — never mutated. Any failure (permissions,
 * schema drift, connection) must fall back to "no recent token" so this check
 * can never block a legitimate reset email from going out.
 */
export async function hasRecentRecoveryToken(authId: string, withinMs: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - withinMs);
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM auth.one_time_tokens
        WHERE user_id = ${authId}::uuid
          AND token_type = 'recovery_token'
          AND created_at > ${cutoff}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}
