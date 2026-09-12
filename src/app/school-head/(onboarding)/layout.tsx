import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { OnboardingShell } from "@/components/onboarding-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";

export const dynamic = "force-dynamic";

export default async function SchoolHeadOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("SCHOOL_HEAD");

  if (user.profileCompleted) {
    redirect(SCHOOL_HEAD_ROUTES.dashboard);
  }

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <>
      {/*
        The school-head app layout bypasses its profiling gate only for a bound
        impersonation session, so an admin can diagnose an unfinished profile.
        This onboarding layout still renders that session's notice and safe exit.
      */}
      <ImpersonationNotice userId={user.id} accountName={userName} />
      {/* No role prefetch — gated app routes are not available yet. */}
      <PostLoginSplash />
      <OnboardingShell>{children}</OnboardingShell>
    </>
  );
}
