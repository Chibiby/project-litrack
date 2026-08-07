import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { PasswordForm } from "@/components/forms/password-form";

export const dynamic = "force-dynamic";

export default async function SchoolHeadPasswordPage() {
  const user = await requireUser("SCHOOL_HEAD");

  return (
    <AppShell
      title="Change password"
      subtitle="Update your account password"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mx-auto max-w-md">
        <PasswordForm mode="change" />
      </div>
    </AppShell>
  );
}
