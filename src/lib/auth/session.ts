import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { roleHomePath } from "@/lib/auth/roles";
import type { User, UserRole } from "@prisma/client";

export { roleHomePath, rolePasswordPath } from "@/lib/auth/roles";

/** App user guaranteed to belong to a school (non-null schoolId). */
export type SchoolUser = User & { schoolId: string };

export type RequireUserOptions = {
  /** When true, allow access even if mustChangePassword is set (set-password flow). */
  allowMustChangePassword?: boolean;
};

/**
 * Returns the authenticated app User, or null.
 * Soft-deleted or inactive users are signed out (best effort) and treated as unauthenticated.
 * Wrapped in React cache() so layout + page requireUser/getCurrentUser dedupe in one request.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const user = await prisma.user.findUnique({
    where: { authId: authUser.id },
  });
  if (!user) return null;

  if (user.deletedAt || !user.isActive) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for inactive/deleted user failed:", err);
    }
    return null;
  }

  return user;
});

/**
 * Requires an authenticated user. Optionally enforces role(s).
 * Redirects to the appropriate login page if not authenticated or wrong role.
 * Super Admin can access any role-restricted page (impersonation mode).
 *
 * When the user must change their password, redirects to `/account/set-password`
 * unless `options.allowMustChangePassword` is true.
 *
 * Signature stays backward-compatible: `requireUser(roles?, allowSuperAdmin?)`.
 */
export async function requireUser(
  roles?: UserRole | UserRole[],
  allowSuperAdmin = true,
  options?: RequireUserOptions
): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const isAdminRoute =
      roles === "SUPER_ADMIN" || (Array.isArray(roles) && roles.includes("SUPER_ADMIN"));
    redirect(isAdminRoute ? "/admin/login" : "/login");
  }

  if (user.mustChangePassword && !options?.allowMustChangePassword) {
    redirect("/account/set-password");
  }

  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (allowSuperAdmin && user.role === "SUPER_ADMIN") {
      return user;
    }
    if (!allowed.includes(user.role)) {
      redirect(roleHomePath(user.role));
    }
  }
  return user;
}

/**
 * Like requireUser, but guarantees a non-null schoolId.
 * Redirects to the role home if the user has no school.
 */
export async function requireSchoolUser(
  roles?: UserRole | UserRole[]
): Promise<SchoolUser> {
  const user = await requireUser(roles);
  if (!user.schoolId) {
    redirect(roleHomePath(user.role));
  }
  return user as SchoolUser;
}

/**
 * Check if user is Super Admin
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "SUPER_ADMIN";
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
