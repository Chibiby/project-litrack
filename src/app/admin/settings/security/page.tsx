import { requireUser } from "@/lib/auth/session";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { PasswordForm } from "@/components/forms/password-form";
import { ChangeEmailForm } from "@/components/forms/change-email-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsSecurityPage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <div className="min-w-0 max-w-xl space-y-6">
      <PasswordForm mode="change" />
      <ChangeEmailForm
        currentEmail={user.email}
        isSynthetic={isSyntheticEmail(user.email)}
      />
    </div>
  );
}
