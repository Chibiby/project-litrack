import { listSchoolsWithTeacherStatus } from "@/lib/actions/school";
import { LoginForm } from "@/components/forms/login-form";
import { GraduationCap } from "lucide-react";

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
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <GraduationCap className="h-7 w-7" />
          </div>
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
