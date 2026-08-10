import { getCurrentUser } from "@/lib/auth/session";
import { RoleShell } from "@/components/role-shell";
import { PostLoginSplash } from "@/components/post-login-splash";

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

  return (
    <>
      <PostLoginSplash role="admin" />
      <RoleShell
        role={user.role}
        userName={user.fullName || user.email}
      >
        {children}
      </RoleShell>
    </>
  );
}
