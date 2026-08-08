import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingShell } from "@/components/onboarding-shell";

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

  return <OnboardingShell>{children}</OnboardingShell>;
}
