import { requireUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfilePhotoCard } from "@/components/profile-photo/profile-photo-card";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsProfilePage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <div className="min-w-0 max-w-2xl space-y-6">
      <ProfilePhotoCard
        name={user.fullName || `${user.firstName} ${user.lastName}`}
        avatarPath={user.avatarPath}
      />
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminProfileForm
            firstName={user.firstName}
            middleName={user.middleName}
            lastName={user.lastName}
            email={user.email}
          />
        </CardContent>
      </Card>
    </div>
  );
}
