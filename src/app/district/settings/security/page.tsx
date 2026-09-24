import { requireAdminScope } from "@/lib/auth/district-scope";
import { PasswordForm } from "@/components/forms/password-form";

export const dynamic = "force-dynamic";

/** Password only: admin accounts sign in by username and have no mailbox to change. */
export default async function DistrictSettingsSecurityPage() {
  await requireAdminScope();

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PasswordForm mode="change" />
    </div>
  );
}
