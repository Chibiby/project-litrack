import { redirect } from "next/navigation";

/**
 * The school-accounts console moved to `/admin/accounts`, which lists every
 * account in the system rather than only School Heads.
 *
 * The file survives as a redirect rather than being deleted because this URL is
 * printed in `docs/runbook.md`, `docs/migrate-checklist.md`,
 * `docs/FINAL-ACCEPTANCE.md` and the in-app help topics, and admins have it
 * bookmarked. `?role=SCHOOL_HEAD` lands them on exactly the view the old page
 * showed.
 *
 * A plain `redirect()` (307), never `permanentRedirect()`: a 308 is cached by
 * browsers indefinitely and would be a nuisance if the console ever moves
 * again. No auth guard here on purpose — the destination is Super-Admin-only
 * and guards itself, and a redirect discloses nothing.
 */
export const dynamic = "force-dynamic";

export default async function SchoolAccountsPage() {
  redirect("/admin/accounts?role=SCHOOL_HEAD");
}
