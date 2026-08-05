import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  const supabaseReady = isSupabaseConfigured();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Super Admin</h1>
          <p className="text-sm text-muted-foreground">PROJECT LITRACK administration</p>
        </div>
        {!supabaseReady ? (
          <div className="rounded-lg border border-border bg-amber-muted px-4 py-3 text-sm text-amber-foreground">
            <p className="font-medium">Setup required</p>
            <p className="mt-1 text-amber-foreground/90">{SUPABASE_NOT_CONFIGURED_MESSAGE}</p>
          </div>
        ) : null}
        <AdminLoginForm disabled={!supabaseReady} />
      </div>
    </main>
  );
}
