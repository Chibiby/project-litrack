import { requireUser, roleHomePath } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { PasswordForm } from "@/components/forms/password-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <AppShell
      title="Change password"
      subtitle="Update your account password"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mx-auto max-w-md space-y-4">
        <PasswordForm mode="change" />
        <p className="text-center text-sm text-muted-foreground">
          <Link href={roleHomePath(user.role)} className="underline hover:text-foreground">
            Back to dashboard
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
