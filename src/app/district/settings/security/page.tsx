import { requireAdminScope } from "@/lib/auth/district-scope";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { AppShell } from "@/components/app-shell";
import { PasswordForm } from "@/components/forms/password-form";
import { DistrictSettingsShell } from "@/components/district/district-settings-shell";

export const dynamic = "force-dynamic";

/** Password only: admin accounts sign in by username and have no mailbox to change. */
export default async function DistrictSettingsSecurityPage() {
  const { user } = await requireAdminScope();

  return (
    <AppShell title="Security" role={user.role} userName={user.fullName || user.email} hideTitle>
      <DistrictSettingsShell active="security" bannerSrc={teacherBannerSrc(null)}>
        <div className="min-w-0 max-w-xl">
          <PasswordForm mode="change" className="rounded-2xl" />
        </div>
      </DistrictSettingsShell>
    </AppShell>
  );
}
