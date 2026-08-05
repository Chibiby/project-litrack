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
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card">
            <GraduationCap className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">PROJECT LITRACK</h1>
          <p className="text-sm text-muted-foreground">School reading-profiling system</p>
          <span className="mx-auto inline-flex rounded-md bg-amber px-2.5 py-0.5 text-xs font-semibold text-amber-foreground">
            Literacy tracking
          </span>
        </div>
        {configUnavailable ? (
          <p className="text-center text-sm text-muted-foreground">
            App is not fully configured. No schools available.
          </p>
        ) : null}
        <LoginForm schools={schools} />
        <p className="text-center text-xs text-muted-foreground">
          Super Admin?{" "}
          <a className="underline" href="/admin/login">
            Admin login
          </a>
        </p>
      </div>
    </main>
  );
}
