import { listSchoolsWithTeacherStatus } from "@/lib/actions/school";
import { LoginForm } from "@/components/forms/login-form";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import Image from "next/image";

/**
 * Not ISR, despite being a public route. This page reads `searchParams`
 * (for the `?error` toast), which opts it into dynamic rendering no matter
 * what the segment config says — a `revalidate` export here builds as
 * `ƒ (Dynamic)` and does nothing.
 *
 * Making it genuinely static would mean moving the `searchParams` read into
 * the client LoginForm behind a Suspense boundary. That is viable but changes
 * behaviour: the school list would be baked at build and up to an hour stale,
 * so a newly-created school could not be selected by its teachers until the
 * next revalidation. Deliberately not done — see docs/superpowers/plans/.
 */

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const loginError =
    typeof params.error === "string" && params.error.trim()
      ? params.error.trim()
      : undefined;

  let schools: Awaited<ReturnType<typeof listSchoolsWithTeacherStatus>> = [];
  let configUnavailable = false;

  try {
    schools = await listSchoolsWithTeacherStatus();
  } catch {
    // DATABASE_URL missing or Prisma unavailable — still render login UI.
    configUnavailable = true;
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
            <h1 className="text-3xl font-bold tracking-tight text-foreground">PROJECT LITRACK</h1>
            <p className="text-sm text-muted-foreground">School reading-profiling system</p>
          </div>
          {configUnavailable ? (
            <p className="text-center text-sm text-muted-foreground">
              App is not fully configured. No schools available.
            </p>
          ) : null}
          <LoginForm schools={schools} loginError={loginError} />
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
          width={240}
          height={74}
          sizes="(max-width: 640px) 200px, 240px"
          className="h-auto w-[200px] object-contain sm:w-[240px]"
        />
      </div>
    </main>
  );
}
