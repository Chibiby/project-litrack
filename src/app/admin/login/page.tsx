import { AdminLoginForm } from "@/components/forms/admin-login-form";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  const supabaseReady = isSupabaseConfigured();

  return (
    <main className="flex min-h-screen flex-col bg-background p-4">
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
          {!supabaseReady ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Setup required</p>
              <p className="mt-1 text-amber-800/90">{SUPABASE_NOT_CONFIGURED_MESSAGE}</p>
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
          width={1024}
          height={314}
          className="h-auto w-[200px] object-contain sm:w-[240px]"
        />
      </div>
    </main>
  );
}
