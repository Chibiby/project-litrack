import { AdminSettingsShell } from "@/components/settings/admin-settings-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { isDeveloperAdmin } from "@/lib/auth/admin-tier";

export default async function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Each page runs its own `requireUser`; this read only decides whether the
  // Demo session row (Developer Controls) is listed.
  const user = await getCurrentUser();
  return (
    <AdminSettingsShell showDemo={user ? isDeveloperAdmin(user) : false}>{children}</AdminSettingsShell>
  );
}
