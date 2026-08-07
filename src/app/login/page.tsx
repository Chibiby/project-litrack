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
            <h1 className="text-3xl font-bold tracking-tight text-foreground">PROJECT LITRACK</h1>
            <p className="text-sm text-muted-foreground">School reading-profiling system</p>
          </div>
          {configUnavailable ? (
            <p className="text-center text-sm text-muted-foreground">
              App is not fully configured. No schools available.
            </p>
          ) : null}
          <LoginForm schools={schools} />
          <p className="text-center text-xs text-muted-foreground">
            Super Admin?{" "}
            <a className="underline hover:text-foreground" href="/admin/login">
              Admin login
            </a>
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
