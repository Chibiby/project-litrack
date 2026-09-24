import { requireAdminScope } from "@/lib/auth/district-scope";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfilePhotoCard } from "@/components/profile-photo/profile-photo-card";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";

export const dynamic = "force-dynamic";

export default async function DistrictSettingsProfilePage() {
  const { user } = await requireAdminScope();

  return (
    <div className="max-w-xl space-y-6">
      <ProfilePhotoCard
        name={user.fullName || `${user.firstName} ${user.lastName}`}
        avatarPath={user.avatarPath}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminProfileForm
            firstName={user.firstName}
            middleName={user.middleName}
            lastName={user.lastName}
            email={user.email}
            securityHref={DISTRICT_ROUTES.settingsSecurity}
          />
        </CardContent>
      </Card>
    </div>
  );
}
