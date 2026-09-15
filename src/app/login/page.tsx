import { listSchoolsWithTeacherStatus } from "@/lib/actions/school";
import { sessionEndCode } from "@/lib/auth/session-end";
import { formatMessage, withReference } from "@/lib/errors/codes";
import { classifyError } from "@/lib/errors/classify";
import { reportError } from "@/lib/errors/report";
import { LoginForm } from "@/components/forms/login-form";
import { LoginShell } from "@/components/auth/login-shell";

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

  // Always light (ALWAYS_LIGHT_PATHS), so there is no theme switch here: dark
  // mode is chosen inside the app, and the stored choice returns after sign-in.
  return (
    <LoginShell>
      <LoginForm
        schools={schools}
        loginError={loginError}
        notice={schoolsUnavailable ?? undefined}
      />
    </LoginShell>
  );
}
