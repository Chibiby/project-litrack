import "server-only";
import type { User } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { loadAdminScopeForUser, loadSchoolInScope } from "@/lib/auth/district-scope";
import { assertSameSchool } from "@/lib/auth/tenant";
import { AppError } from "@/lib/errors/app-error";

/**
 * Who may act for `schoolId` on a cross-school transfer: that school's School
 * Head, or a Super Admin / District admin whose scope covers the school. A
 * school outside the caller's reach reads as NOT_FOUND (recorded as
 * cross-tenant), never as "forbidden", so its existence does not leak.
 */
export async function resolveTransferActor(
  schoolId: string
): Promise<{ user: User; schoolId: string; viaAdmin: boolean }> {
  const user = await requireUser(["SCHOOL_HEAD", "SUPER_ADMIN", "DISTRICT_ADMIN"], false);

  if (user.role === "SCHOOL_HEAD") {
    assertSameSchool(user.schoolId ?? "", schoolId, "School");
    return { user, schoolId, viaAdmin: false };
  }

  if (user.role === "SUPER_ADMIN" || user.role === "DISTRICT_ADMIN") {
    const scope = await loadAdminScopeForUser(user);
    await loadSchoolInScope(scope, schoolId, { id: true });
    return { user, schoolId, viaAdmin: true };
  }

  throw new AppError("AUTH_FORBIDDEN", { detail: `role ${user.role} cannot act on transfers` });
}
