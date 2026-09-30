import { requireUser } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/admin-page";
import { loadAdminDashboard } from "@/components/dashboard/admin/dashboard-body";
import { isDeveloperAdmin } from "@/lib/auth/admin-tier";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireUser("SUPER_ADMIN");
  const { hero, body } = await loadAdminDashboard({
    firstName: user.firstName || user.fullName || "Admin",
    isDeveloperAdmin: isDeveloperAdmin(user),
  });

  return (
    <AdminPage
      title="Admin Dashboard"
      role={user.role}
      userName={user.fullName || user.email}
      hero={hero}
      contentClassName="min-w-0"
    >
      {body}
    </AdminPage>
  );
}
