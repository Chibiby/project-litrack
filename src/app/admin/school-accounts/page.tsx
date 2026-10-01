import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * The school-accounts console is now Management → School Heads.
 *
 * The file survives as a redirect rather than being deleted because this URL is
 * printed in `docs/runbook.md`, `docs/migrate-checklist.md`,
 * `docs/FINAL-ACCEPTANCE.md` and the in-app help topics, and admins have it
 * bookmarked. School Heads is exactly the view the old page showed.
 *
 * A plain `redirect()` (307), never `permanentRedirect()`: a 308 is cached by
 * browsers indefinitely and would be a nuisance if the console ever moves
 * again. No auth guard here on purpose — the destination is Super-Admin-only
 * and guards itself, and a redirect discloses nothing.
 */
export const dynamic = "force-dynamic";

export default async function SchoolAccountsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.schoolHeads, await searchParams, ["role"]));
}
