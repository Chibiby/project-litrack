import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { AppShell } from "@/components/app-shell";
import { PasswordForm } from "@/components/forms/password-form";
import { ChangeEmailForm } from "@/components/forms/change-email-form";
import { SchoolHeadSettingsShell } from "@/components/settings/school-head-settings-shell";

export const dynamic = "force-dynamic";

export default async function SchoolHeadSettingsSecurityPage() {
  const user = await requireUser("SCHOOL_HEAD");

  // Hero art must never take the page down: any read failure (including a
  // database the gender migration has not reached yet) falls back to the
  // default banner.
  const gender = await prisma.schoolHeadProfile
    .findUnique({ where: { userId: user.id }, select: { gender: true } })
    .then((p) => p?.gender ?? null)
    .catch(() => null);

  return (
    <AppShell
      title="Profile Settings"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      hideTitle
    >
      <SchoolHeadSettingsShell active="security" bannerSrc={teacherBannerSrc(gender)}>
        <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-2">
          <PasswordForm mode="change" className="rounded-2xl" />
          <ChangeEmailForm
            currentEmail={user.email}
            isSynthetic={isSyntheticEmail(user.email)}
            className="rounded-2xl"
          />
        </div>
      </SchoolHeadSettingsShell>
    </AppShell>
  );
}
