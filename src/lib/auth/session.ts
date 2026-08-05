import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findAppUserByAuthId } from "@/lib/auth/app-user";
import { isSuperAdmin, roleHomePath } from "@/lib/auth/roles";
import type { User, UserRole } from "@prisma/client";

export { isSuperAdmin, roleHomePath };

/**
 * Returns the authenticated app User, or null.
 * Prefers PostgREST public."User" (works without Prisma DATABASE_URL), then Prisma,
 * then SUPER_ADMIN via app_metadata.role as last resort.
 * Inactive / soft-deleted users resolve to null (caller redirects to login).
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  return findAppUserByAuthId(authUser.id, { authUser, supabase });
}

/**
 * Requires an authenticated user. Optionally enforces role(s).
 * Redirects to the appropriate login page if not authenticated or wrong role.
 * Super Admin can access any role-restricted page (impersonation mode).
 */
export async function requireUser(roles?: UserRole | UserRole[], allowSuperAdmin = true): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const isAdminRoute = roles === "SUPER_ADMIN" || (Array.isArray(roles) && roles.includes("SUPER_ADMIN"));
    redirect(isAdminRoute ? "/admin/login" : "/login");
  }

  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    // Super Admin can access any role-restricted page when allowSuperAdmin is true
    if (allowSuperAdmin && user.role === "SUPER_ADMIN") {
      return user;
    }
    if (!allowed.includes(user.role)) {
      redirect(roleHomePath(user.role));
    }
  }
  return user;
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
