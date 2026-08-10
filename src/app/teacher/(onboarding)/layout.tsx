import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingShell } from "@/components/onboarding-shell";
import { PostLoginSplash } from "@/components/post-login-splash";

export const dynamic = "force-dynamic";

export default async function TeacherOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("TEACHER");

  if (user.profileCompleted) {
    redirect("/teacher");
  }

  return (
    <>
      {/* No role prefetch — gated app routes are not available yet. */}
      <PostLoginSplash />
      <OnboardingShell>{children}</OnboardingShell>
    </>
  );
}
