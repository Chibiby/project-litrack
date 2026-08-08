import { requireUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsProfilePage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <Card className="max-w-xl">
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
  );
}
