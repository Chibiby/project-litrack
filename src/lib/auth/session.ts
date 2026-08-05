import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { User, UserRole } from "@prisma/client";

/**
 * Returns the authenticated app User, or null.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const user = await prisma.user.findUnique({
    where: { authId: authUser.id },
  });
  return user;
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

/**
 * Check if user is Super Admin
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "SUPER_ADMIN";
}

export function roleHomePath(role: UserRole): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/admin";
    case "SCHOOL_HEAD":
      return "/school-head";
    case "TEACHER":
      return "/teacher";
  }
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
