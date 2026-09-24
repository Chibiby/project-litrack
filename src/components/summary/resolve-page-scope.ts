import "server-only";
import { notFound } from "next/navigation";
import { resolveSummaryScope, type AdminScope, type SummaryScope } from "@/lib/auth/admin-scope";
import { loadSchoolInScope } from "@/lib/auth/district-scope";
import { isAppError } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";

export type PageSummaryScope = {
  scope: SummaryScope;
  district: string | null;
  school: { id: string; name: string } | null;
};

/**
 * The only way a summary page narrows its scope. A requested school is loaded
 * through `loadSchoolInScope` (scope in the WHERE) before any facet reads it,
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
    const school =
      scope.kind === "school"
        ? await loadSchoolInScope(adminScope, scope.schoolId, { id: true, name: true })
        : null;
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
