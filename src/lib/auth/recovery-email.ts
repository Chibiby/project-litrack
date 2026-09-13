import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

export async function sendPasswordRecoveryEmail(email: string, redirectTo: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  const link = data.properties?.action_link;
  if (error || !link) throw new Error("Recovery link generation failed");

  await sendEmail({
    to: [email],
    subject: "Reset your LITRACK password",
    text: `A password reset was requested for your LITRACK account.\n\nReset your password: ${link}\n\nIf you did not request this, you can ignore this email.`,
  });
}
