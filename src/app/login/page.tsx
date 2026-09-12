import { listSchoolsWithTeacherStatus } from "@/lib/actions/school";
import { sessionEndCode } from "@/lib/auth/session-end";
import { formatMessage, withReference } from "@/lib/errors/codes";
import { classifyError } from "@/lib/errors/classify";
import { reportError } from "@/lib/errors/report";
import { LoginForm } from "@/components/forms/login-form";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import Image from "next/image";
import Link from "next/link";

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
  searchParams: Promise<{ reason?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  // An allow-listed token, never text from the URL: this page used to render
  // `?error=<anything>` straight into a toast.
  const endedCode = sessionEndCode(params.reason);
  const loginError = endedCode ? formatMessage(endedCode) : undefined;

  let schools: Awaited<ReturnType<typeof listSchoolsWithTeacherStatus>> = [];
  let schoolsUnavailable: string | null = null;

  try {
    schools = await listSchoolsWithTeacherStatus();
  } catch (err) {
    // An unreachable database and a missing DATABASE_URL are different problems
    // with different fixes, and "no schools available" told the visitor neither.
    // The variable names stay in the admin record; the person gets a reference.
    const appError = classifyError(err, { verb: "load the school list" });
    const ref = reportError(appError, { route: "/login", routeType: "render" });
    schoolsUnavailable = withReference(
      appError.message,
      appError.severity === "system" ? ref : undefined
    );
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
          {schoolsUnavailable ? (
            <p className="text-center text-sm text-muted-foreground">{schoolsUnavailable}</p>
          ) : null}
          <LoginForm schools={schools} loginError={loginError} />
          <p className="text-center text-xs text-muted-foreground">
            Super Admin?{" "}
            <Link className="underline hover:text-foreground" href="/admin/login">
              Admin login
            </Link>
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
