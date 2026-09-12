import Image from "next/image";
import { requireUser } from "@/lib/auth/session";
import { PasswordForm } from "@/components/forms/password-form";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const user = await requireUser(undefined, true, { allowMustChangePassword: true });
  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background p-4">
      {/*
        Where `mustChangePassword` force-redirects any impersonated account,
        teacher or School Head alike. Without this an impersonating admin is
        signed in as someone else on a page with no way back.
      */}
      <ImpersonationNotice userId={user.id} accountName={userName} />
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.png"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-28 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight">Set your password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a private password to replace the credential you signed in with. School Heads can
            skip this and do it later from Settings → Security.
          </p>
        </div>
        <PasswordForm mode="set" allowSkip={user.role === "SCHOOL_HEAD"} />
      </div>
    </main>
  );
}
