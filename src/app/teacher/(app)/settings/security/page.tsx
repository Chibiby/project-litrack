import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { AppShell } from "@/components/app-shell";
import { PasswordForm } from "@/components/forms/password-form";
import { ChangeEmailForm } from "@/components/forms/change-email-form";
import { TeacherSettingsShell } from "@/components/settings/teacher-settings-shell";

export const dynamic = "force-dynamic";

export default async function TeacherSettingsSecurityPage() {
  const user = await requireUser("TEACHER");
  const profile = await prisma.teacherProfile.findUnique({
    where: { userId: user.id },
    select: { gender: true },
  });

  return (
    <AppShell
      title="Profile Settings"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      hideTitle
    >
      <TeacherSettingsShell active="security" bannerSrc={teacherBannerSrc(profile?.gender)}>
        <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-2">
          <PasswordForm mode="change" className="rounded-2xl" />
          <ChangeEmailForm
            currentEmail={user.email}
            isSynthetic={isSyntheticEmail(user.email)}
            className="rounded-2xl"
          />
        </div>
      </TeacherSettingsShell>
    </AppShell>
  );
}
