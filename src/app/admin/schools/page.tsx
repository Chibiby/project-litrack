import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to Management → Schools. Kept as a redirect because admins bookmarked
 * this URL and docs print it; the query string carries over so a saved filter
 * still applies.
 *
 * A plain `redirect()` (307), never `permanentRedirect()`: a 308 is cached by
 * browsers indefinitely and would be a nuisance if the page ever moves again.
 * No auth guard on purpose — the destination guards itself, and a redirect
 * discloses nothing.
 */
export const dynamic = "force-dynamic";

export default async function LegacySchoolsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.schools, await searchParams));
}
