import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminProfileForm } from "@/components/admin/admin-profile-form";

export const dynamic = "force-dynamic";

export default async function AdminProfilePage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AppShell
      title="Profile"
      subtitle="Update your Super Admin display name"
      role={user.role}
      userName={user.fullName || user.email}
    >
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
    </AppShell>
  );
}
