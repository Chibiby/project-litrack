import { redirect } from "next/navigation";
import { accountsRoleRoute, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * The all-roles accounts console split into one Management page per role.
 * `?role=SCHOOL_HEAD` lands on School Heads, `?role=DISTRICT_ADMIN` on
 * District Admins, anything else (no role, TEACHER, SUPER_ADMIN) on Teachers.
 * `role` is dropped because the destination fixes it; every other param
 * (search, school, grade, sort, page) carries over.
 *
 * Survives as a redirect because this URL is printed in `docs/runbook.md`, the
 * help topics, and admins' bookmarks. A plain `redirect()` (307), never
 * `permanentRedirect()`: a 308 is cached by browsers indefinitely. No auth
 * guard on purpose — the destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacyAccountsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  redirect(withSearchParams(accountsRoleRoute(params.role), params, ["role"]));
}
