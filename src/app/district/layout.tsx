import { requireAdminScope } from "@/lib/auth/district-scope";
import { getDistrictNotifications } from "@/lib/district/notifications";
import { RoleShell } from "@/components/role-shell";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";
import { readImpersonation } from "@/lib/auth/impersonation-session";

export const dynamic = "force-dynamic";

export default async function DistrictLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, scope } = await requireAdminScope();

  // A Super Admin signed in as a district admin ("Sign in as" / Test Lab) is
  // that district admin here: the session is theirs, so `scope` is their
  // districts. The banner is the way back, as on School Head and teacher pages.
  const impersonation = await readImpersonation();
  const impersonating = impersonation?.targetUserId === user.id;
  const userName = user.fullName || user.email;
  const districtLabel = scope.kind === "districts" ? scope.districts.join(", ") : "";

  return (
    <>
      <ImpersonationNotice
        userId={user.id}
        accountName={districtLabel ? `${userName} · ${districtLabel}` : userName}
        impersonation={impersonation}
      />
      <RoleShell
        role={user.role}
        userId={user.id}
        userName={userName}
        avatarPath={user.avatarPath}
        // Not awaited: streamed through RoleShell/AppHeader so the chrome paints
        // before the open-ticket count resolves.
        notifications={getDistrictNotifications(user, scope)}
        // Not while an admin impersonates: acknowledging would stamp the
        // district admin's own row, and they would never see the release.
        lastSeenReleaseVersion={impersonating ? undefined : user.lastSeenReleaseVersion}
      >
        {children}
      </RoleShell>
    </>
  );
}
