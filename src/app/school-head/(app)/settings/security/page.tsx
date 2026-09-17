import { requireUser } from "@/lib/auth/session";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { PasswordForm } from "@/components/forms/password-form";
import { ChangeEmailForm } from "@/components/forms/change-email-form";
import { readTestLabSession } from "@/lib/auth/test-lab";

export const dynamic = "force-dynamic";

export default async function SchoolHeadSettingsSecurityPage() {
  const user = await requireUser("SCHOOL_HEAD");
  const dryRun = await readTestLabSession(user);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PasswordForm mode="change" dryRun={dryRun} />
      <ChangeEmailForm
        currentEmail={user.email}
        isSynthetic={isSyntheticEmail(user.email)}
        dryRun={dryRun}
      />
    </div>
  );
}
