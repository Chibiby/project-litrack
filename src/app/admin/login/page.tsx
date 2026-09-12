import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { sessionEndCode } from "@/lib/auth/session-end";
import { formatMessage } from "@/lib/errors/codes";
import { AppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";

type AdminLoginPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const endedCode = sessionEndCode(params.reason);
  const supabaseReady = isSupabaseConfigured();

  if (!supabaseReady) {
    // Recorded once per render while misconfigured — which is the only time it
    // happens, and the only way anyone learns of it before a school calls.
    reportError(
      new AppError("CONFIG_MISSING", {
        detail: SUPABASE_NOT_CONFIGURED_MESSAGE,
        context: { reason: "supabase_env_missing" },
      }),
      { route: "/admin/login", routeType: "render" }
    );
  }

  return (
    <main id="main-content" className="flex min-h-screen flex-col bg-background p-4">
      {/* Pre-auth screens carry no app header, so the theme switch lives here —
          otherwise dark mode is only reachable after signing in. */}
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <Image
              src="/logo.png"
              alt="ARAL Program logo"
              width={192}
              height={256}
              priority
              className="mx-auto h-40 w-auto"
            />
            <h1 className="text-2xl font-bold tracking-tight">Super Admin</h1>
            <p className="text-sm text-muted-foreground">PROJECT LITRACK administration</p>
          </div>
          {endedCode ? (
            <div className="rounded-xl border border-border/80 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {formatMessage(endedCode)}
            </div>
          ) : null}
          {!supabaseReady ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Sign-in unavailable</p>
              {/* The env var names went to the error record, not to this page:
                  /admin/login is public, and anyone can read what is printed here. */}
              <p className="mt-1 text-amber-800/90">{formatMessage("CONFIG_MISSING")}</p>
            </div>
          ) : null}
          <AdminLoginForm disabled={!supabaseReady} />
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              School login
            </Link>
          </p>
        </div>
      </div>
      <div className="flex justify-center pt-6 pb-2">
        <Image
          src="/partner-logos.png"
          alt="Partner organizations: DepEd MATATAG, Bagong Pilipinas, and Division of Sarangani"
          width={240}
          height={74}
          sizes="(max-width: 640px) 200px, 240px"
          className="h-auto w-[200px] object-contain sm:w-[240px]"
        />
      </div>
    </main>
  );
}
