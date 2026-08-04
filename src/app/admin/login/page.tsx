import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  const supabaseReady = isSupabaseConfigured();

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Super Admin</h1>
          <p className="text-sm text-muted-foreground">PROJECT LITRACK administration</p>
        </div>
        {!supabaseReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Setup required</p>
            <p className="mt-1 text-amber-800/90">{SUPABASE_NOT_CONFIGURED_MESSAGE}</p>
          </div>
        ) : null}
        <AdminLoginForm disabled={!supabaseReady} />
      </div>
    </main>
  );
}
