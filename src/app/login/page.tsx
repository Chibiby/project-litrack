import { listSchoolsWithTeacherStatus } from "@/lib/actions/school";
import { LoginForm } from "@/components/forms/login-form";
import Image from "next/image";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let schools: Awaited<ReturnType<typeof listSchoolsWithTeacherStatus>> = [];
  let configUnavailable = false;

  try {
    schools = await listSchoolsWithTeacherStatus();
  } catch {
    // DATABASE_URL missing or Prisma unavailable — still render login UI.
    configUnavailable = true;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-white p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Image
            src="/logo.png"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-40 w-auto"
          />
          <h1 className="text-3xl font-bold tracking-tight">PROJECT LITRACK</h1>
          <p className="text-sm text-muted-foreground">School reading-profiling system</p>
        </div>
        {configUnavailable ? (
          <p className="text-center text-sm text-muted-foreground">
            App is not fully configured. No schools available.
          </p>
        ) : null}
        <LoginForm schools={schools} />
        <p className="text-center text-xs text-muted-foreground">
          Super Admin? <a className="underline" href="/admin/login">Admin login</a>
        </p>
      </div>
    </main>
  );
}
