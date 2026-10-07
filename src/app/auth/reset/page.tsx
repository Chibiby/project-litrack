import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { PasswordForm } from "@/components/forms/password-form";
import { Card, CardContent } from "@/components/ui/card";
import { resetErrorMessage } from "@/lib/auth/reset-messages";
import { peekResetToken } from "@/lib/auth/password-reset";
import { RESET_COOKIE } from "@/lib/auth/recovery-email";

export const dynamic = "force-dynamic";

export default async function AuthResetPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    error_code?: string;
    error_description?: string;
  }>;
}) {
  const params = await searchParams;
  let sessionReady = false;
  let errorMessage: string | null = resetErrorMessage(params);

  try {
    // The token arrives only as the httpOnly cookie `/auth/confirm/verify`
    // set; it is checked here, never used up (the save action consumes it).
    const token = (await cookies()).get(RESET_COOKIE)?.value;
    sessionReady = Boolean(token && (await peekResetToken(token)));
    if (!sessionReady && !errorMessage) {
      errorMessage = "Open the link from your email to continue, or request a new reset link.";
    }
  } catch {
    errorMessage = "Unable to start password reset. Try again from the forgot-password page.";
  }

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.webp"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-28 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
        </div>
        {sessionReady ? (
          <PasswordForm mode="reset" />
        ) : (
          <Card className="rounded-xl border border-border/80 shadow-sm">
            <CardContent className="space-y-3 pt-6 text-center text-sm">
              <p className="text-destructive">{errorMessage}</p>
              <Link href="/forgot-password" className="underline hover:text-foreground">
                Request a new reset link
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
