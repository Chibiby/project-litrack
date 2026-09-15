import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { LoginShell } from "@/components/auth/login-shell";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { sessionEndCode } from "@/lib/auth/session-end";
import { formatMessage } from "@/lib/errors/codes";
import { AppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";

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

  // Same frame as /login, and always light for the same reason.
  return (
    <LoginShell>
      <AdminLoginForm
        disabled={!supabaseReady}
        notice={
          <>
            {endedCode ? (
              <div className="rounded-xl border border-slate-200 bg-muted/60 px-4 py-3 text-sm text-slate-700">
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
          </>
        }
      />
    </LoginShell>
  );
}
