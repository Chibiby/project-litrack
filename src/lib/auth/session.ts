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

export type GetCurrentUserOptions = {
  /** When true, return pending/rejected teachers without redirecting (pending-approval page). */
  allowPending?: boolean;
};

export type RequireUserOptions = {
  /** When true, allow access even if mustChangePassword is set (set-password flow). */
  allowMustChangePassword?: boolean;
  /** When true, allow TEACHER users who are pending approval (or inactive pending-like). */
  allowPending?: boolean;
};

function isTeacherRejected(user: User): boolean {
  return user.role === "TEACHER" && user.approvalStatus === "REJECTED";
}

/** Pending approval, or inactive teacher who is not explicitly rejected. */
function isTeacherPendingGate(user: User): boolean {
  return (
    user.role === "TEACHER" &&
    (user.approvalStatus === "PENDING" ||
      (!user.isActive && user.approvalStatus !== "REJECTED"))
  );
}

async function loadUserByAuthId(authId: string): Promise<User | null> {
  // Retry once on P2024 (pool timeout). Rapid teacher soft-nav + full prefetch
  // can briefly queue past the serverless pool wait; a short backoff clears most
  // transient failures before they hit teacher/error.tsx.
  try {
    return await prisma.user.findUnique({ where: { authId } });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code !== "P2024") throw err;
    await new Promise((r) => setTimeout(r, 75));
    return prisma.user.findUnique({ where: { authId } });
  }
}

/**
 * Cached by allowPending boolean so React cache() dedupes correctly across callers.
 */
const getCurrentUserCached = cache(async (allowPending: boolean): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const user = await loadUserByAuthId(authUser.id);
  if (!user) return null;

  if (user.deletedAt) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for deleted user failed:", err);
    }
    return null;
  }

  if (isTeacherRejected(user)) {
    if (allowPending) {
      return user;
    }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for rejected teacher failed:", err);
    }
    redirect("/login");
  }

  if (isTeacherPendingGate(user)) {
    if (allowPending) {
      return user;
    }
    redirect("/pending-approval");
  }

  // Soft-deleted already handled. Inactive non-pending users (SH/admin/legacy): sign out.
  if (!user.isActive) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for inactive user failed:", err);
    }
    return null;
  }

  return user;
});

/**
 * Returns the authenticated app User, or null.
 * Soft-deleted or inactive users are signed out (best effort) and treated as unauthenticated,
 * except pending teachers (see allowPending / pending-approval redirect).
 */
export async function getCurrentUser(options?: GetCurrentUserOptions): Promise<User | null> {
  return getCurrentUserCached(Boolean(options?.allowPending));
}

/**
 * Requires an authenticated user. Optionally enforces role(s).
 * Redirects to the appropriate login page if not authenticated or wrong role.
 * Super Admin can access any role-restricted page (impersonation mode).
 *
 * When the user must change their password, redirects to `/account/set-password`
 * unless `options.allowMustChangePassword` is true.
 *
 * Pending teachers redirect to `/pending-approval` unless `options.allowPending` is true.
 *
 * Signature stays backward-compatible: `requireUser(roles?, allowSuperAdmin?)`.
 */
export async function requireUser(
  roles?: UserRole | UserRole[],
  allowSuperAdmin = true,
  options?: RequireUserOptions
): Promise<User> {
  const user = await getCurrentUser({ allowPending: options?.allowPending });
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
