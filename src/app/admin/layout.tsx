import { getCurrentUser } from "@/lib/auth/session";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";
import { AdminShellGate } from "@/components/admin-shell-gate";
import { geminiConfigured } from "@/lib/assistant/gemini";
import { getChatNotifications } from "@/lib/chat/notifications";
import { isDeveloperAdmin, superAdminLabel } from "@/lib/auth/admin-tier";

// Force dynamic so Next doesn't try to statically prerender these auth-gated
// pages at build time, when Supabase/DATABASE_URL env may not be reachable.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // /admin/login lives under this segment — do not require auth or mount the
  // sidebar shell for unauthenticated (or non–super-admin) visitors.
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return children;
  }

  // A signed-in admin can still be on /admin/login (mid sign-in, or a client
  // navigation that keeps this layout mounted); the gate keeps it bare there.
  return (
    <AdminShellGate
      shell={
        <>
          <PostLoginSplash role="admin" />
          <RoleShell
            role={user.role}
            userId={user.id}
            userName={user.fullName || user.email}
            avatarPath={user.avatarPath}
            roleLabel={superAdminLabel(user)}
            isDeveloperAdmin={isDeveloperAdmin(user)}
            aiEnabled={geminiConfigured()}
            // Not awaited: streamed through RoleShell/AppHeader as a promise so the
            // sidebar and header paint before the notifications query resolves.
            notifications={getChatNotifications(user)}
            lastSeenReleaseVersion={user.lastSeenReleaseVersion}
          >
            {children}
          </RoleShell>
        </>
      }
    >
      {children}
    </AdminShellGate>
  );
}
