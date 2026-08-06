import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PasswordForm } from "@/components/forms/password-form";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AuthResetPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
}) {
  const params = await searchParams;
  let sessionReady = false;
  let errorMessage: string | null = params.error_description ?? params.error ?? null;

  try {
    const supabase = await createSupabaseServerClient();
    if (params.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        errorMessage = "This reset link is invalid or has expired. Request a new one.";
      } else {
        sessionReady = true;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      sessionReady = Boolean(user);
      if (!sessionReady && !errorMessage) {
        errorMessage = "Open the link from your email to continue, or request a new reset link.";
      }
    }
  } catch {
    errorMessage = "Unable to start password reset. Try again from the forgot-password page.";
  }

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
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
        </div>
        {sessionReady ? (
          <PasswordForm mode="reset" />
        ) : (
          <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
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
