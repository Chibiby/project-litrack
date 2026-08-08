import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingShell } from "@/components/onboarding-shell";

export const dynamic = "force-dynamic";

export default async function SchoolHeadOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("SCHOOL_HEAD");

  if (user.profileCompleted) {
    redirect("/school-head");
  }

  return <OnboardingShell>{children}</OnboardingShell>;
}
