import "server-only";
import { notFound } from "next/navigation";
import { resolveSummaryScope, type AdminScope, type SummaryScope } from "@/lib/auth/admin-scope";
import { loadSchoolInScope } from "@/lib/auth/district-scope";
import { isAppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import { findSchoolInAdminScope } from "@/lib/summary/scope-schools";

export type PageSummaryScope = {
  scope: SummaryScope;
  district: string | null;
  school: { id: string; name: string } | null;
};

/**
 * A requested school inside `adminScope`. The cached division list answers
 * first (no database read for a school the admin may open); a miss goes to
 * `loadSchoolInScope`, which reads with the scope in the WHERE and throws the
 * NOT_FOUND, marked `crossTenant` for a live school outside a district scope,
 * so an out-of-scope request is still recorded. A school created after the
 * list was cached is also found there.
 */
async function schoolInScope(
  adminScope: AdminScope,
  schoolId: string
): Promise<{ id: string; name: string }> {
  const hit = await findSchoolInAdminScope(adminScope, schoolId);
  if (hit) return { id: hit.id, name: hit.name };
  return loadSchoolInScope(adminScope, schoolId, { id: true, name: true });
}

/**
 * The only way a summary page narrows its scope. A requested school is checked
 * against the admin's scope (`schoolInScope`) before any facet reads it,
 * because `facet.load` does not guard a `school` scope itself.
 *
 * An out-of-scope district or school renders the same 404 a missing one does;
 * the cross-tenant ones are still recorded for the admin error log, as the
 * action wrapper would.
 */
export async function resolvePageSummaryScope(
  adminScope: AdminScope,
  requested: { district?: string; schoolId?: string },
  context: { route: string; userId: string }
): Promise<PageSummaryScope> {
  let result: PageSummaryScope | null = null;
  try {
    const scope = resolveSummaryScope(adminScope, requested);
    const school = scope.kind === "school" ? await schoolInScope(adminScope, scope.schoolId) : null;
    result = { scope, district: requested.district || null, school };
  } catch (err) {
    if (!isAppError(err) || err.code !== "NOT_FOUND") throw err;
    if (err.severity === "security") {
      reportError(err, { route: context.route, routeType: "render", userId: context.userId });
    }
  }
  if (!result) notFound();
  return result;
}
