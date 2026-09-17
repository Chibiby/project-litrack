import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingShell } from "@/components/onboarding-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";
import { readTestLabSession } from "@/lib/auth/test-lab";

export const dynamic = "force-dynamic";

export default async function TeacherOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("TEACHER");

  // A Test Lab session may reopen the wizard on an already-profiled demo
  // account to exercise it; every real session keeps the redirect.
  if (user.profileCompleted && !(await readTestLabSession(user))) {
    redirect("/teacher");
  }

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <>
      {/*
        No profiling bypass here: the teacher app layout deliberately does not
        skip this wizard for an impersonating admin (see its comment), so an
        admin lands on this exact page. This layout is the way out — it is
        the one that carries the banner.
      */}
      <ImpersonationNotice userId={user.id} accountName={userName} />
      {/* No role prefetch — gated app routes are not available yet. */}
      <PostLoginSplash />
      <OnboardingShell>{children}</OnboardingShell>
    </>
  );
}
