import { requireAdminScope } from "@/lib/auth/district-scope";
import { getDistrictNotifications } from "@/lib/district/notifications";
import { RoleShell } from "@/components/role-shell";

export const dynamic = "force-dynamic";

export default async function DistrictLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, scope } = await requireAdminScope();

  return (
    <RoleShell
      role={user.role}
      userId={user.id}
      userName={user.fullName || user.email}
      avatarPath={user.avatarPath}
      // Not awaited: streamed through RoleShell/AppHeader so the chrome paints
      // before the open-ticket count resolves.
      notifications={getDistrictNotifications(user, scope)}
      lastSeenReleaseVersion={user.lastSeenReleaseVersion}
    >
      {children}
    </RoleShell>
  );
}
