import { requireAdminScope } from "@/lib/auth/district-scope";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { ProfilePhotoCard } from "@/components/profile-photo/profile-photo-card";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";
import { DistrictSettingsShell } from "@/components/district/district-settings-shell";

export const dynamic = "force-dynamic";

export default async function DistrictSettingsProfilePage() {
  const { user } = await requireAdminScope();
  const name = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <AppShell title="Profile" role={user.role} userName={user.fullName || user.email} hideTitle>
      <DistrictSettingsShell active="profile" bannerSrc={teacherBannerSrc(null)}>
        <ProfilePhotoCard name={name} avatarPath={user.avatarPath} />
        <Surface as="section" aria-labelledby="district-account-title" className="min-w-0 rounded-2xl">
          <SurfaceHeader className="px-4 sm:px-5">
            <h2 id="district-account-title" className="text-base font-semibold">
              Account details
            </h2>
          </SurfaceHeader>
          <SurfaceBody className="p-4 sm:p-5">
            <AdminProfileForm
              firstName={user.firstName}
              middleName={user.middleName}
              lastName={user.lastName}
              email={user.email}
              securityHref={DISTRICT_ROUTES.settingsSecurity}
            />
          </SurfaceBody>
        </Surface>
      </DistrictSettingsShell>
    </AppShell>
  );
}
