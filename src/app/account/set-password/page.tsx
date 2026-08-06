import Image from "next/image";
import { requireUser } from "@/lib/auth/session";
import { PasswordForm } from "@/components/forms/password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  await requireUser(undefined, true, { allowMustChangePassword: true });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
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
            Choose a private password before continuing. This replaces your one-time activation
            credential.
          </p>
        </div>
        <PasswordForm mode="set" />
      </div>
    </main>
  );
}
