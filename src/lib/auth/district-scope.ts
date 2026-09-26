import "server-only";
import { cache } from "react";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { adminScopeFor, schoolWhereForScope, type AdminScope } from "@/lib/auth/admin-scope";

/**
 * Which schools an administrator may see and change: the server half.
 *
 * Every district-scoped page and action starts with `requireAdminScope()`, and
 * never with `requireUser("DISTRICT_ADMIN")` alone: `requireUser` lets a Super
 * Admin through every role list implicitly, and the Super Admin branch here has
 * to be explicit (docs/specs/district-admin.md 3.4, invariant I8).
 */

function forbidden(role: string): AppError {
  return new AppError("AUTH_FORBIDDEN", {
    params: { what: "the admin console" },
    detail: `role ${role} reached an admin-scoped page or action`,
    context: { role },
  });
}

/**
 * The scope-from-user logic, split out of `loadAdminScope` so a caller that
 * already has the `User` row (e.g. the admin-console login action, which runs
 * before the session cookie is readable back through `requireUser`) can
 * resolve the same scope without a second Prisma round trip through
 * `getCurrentUser`.
 *
 * Not memoized: the login caller runs it once per sign-in, and `loadAdminScope`
 * below keeps its own per-request `cache()` wrapper for the page/action path.
 */
export async function loadAdminScopeForUser(user: Pick<User, "id" | "role">): Promise<AdminScope> {
  if (user.role === "SUPER_ADMIN") {
    return { kind: "division" };
  }

  if (user.role === "DISTRICT_ADMIN") {
    const rows = await prisma.districtAdminAssignment.findMany({
      where: { userId: user.id },
      select: { district: true },
    });
    const scope = adminScopeFor(user.role, rows.map((r) => r.district));
    if (scope) return scope;
  }

  // A School Head or teacher that got past `requireUser` (it redirects them in
  // practice) is refused here and recorded with severity `security`.
  throw forbidden(user.role);
}

/**
 * Memoized per request with React `cache()`. The assignments are read fresh on
 * every request and never put in a cross-request cache, so removing an
 * assignment takes effect on the admin's next request.
 */
const loadAdminScope = cache(async (): Promise<{ user: User; scope: AdminScope }> => {
  // Redirects a signed-out visitor to /admin/login, and anyone whose role is in
  // neither list to their own home. `allowSuperAdmin` is off: SUPER_ADMIN is
  // named in the list, so nothing here rests on the impersonation default.
  const user = await requireUser(["SUPER_ADMIN", "DISTRICT_ADMIN"], false);
  const scope = await loadAdminScopeForUser(user);
  return { user, scope };
});

export async function requireAdminScope(): Promise<{ user: User; scope: AdminScope }> {
  return loadAdminScope();
}

/**
 * Load one school only if it is inside `scope`. The scope is part of the WHERE,
 * the same way `schoolId: user.schoolId` is everywhere else, so an out-of-scope
 * row is never read into memory.
 *
 * A miss throws the NOT_FOUND a missing school gets. For a district scope a
 * second, id-only probe decides whether the miss was a live school outside the
 * scope, so the admin error log can mark it `crossTenant` (severity
 * `security`); the person sees the same message either way.
 */
export async function loadSchoolInScope<S extends Prisma.SchoolSelect>(
  scope: AdminScope,
  schoolId: string,
  select: S
): Promise<Prisma.SchoolGetPayload<{ select: S }>> {
  const row = await prisma.school.findFirst({
    where: { AND: [{ id: schoolId }, schoolWhereForScope(scope)] },
    select,
  });
  if (row) return row as Prisma.SchoolGetPayload<{ select: S }>;

  if (scope.kind === "districts") {
    const exists = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      select: { id: true },
    });
    if (exists) {
      throw resourceNotFound("School", {
        crossTenant: true,
        detail: `School ${schoolId} is outside the district admin's scope ${JSON.stringify(scope.districts)}`,
      });
    }
  }
  throw resourceNotFound("School");
}
