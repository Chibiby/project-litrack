import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import Image from "next/image";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  const supabaseReady = isSupabaseConfigured();

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Image
            src="/logo.png"
            alt="LiTrack logo"
            width={64}
            height={64}
            priority
            className="mx-auto h-16 w-16"
          />
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
