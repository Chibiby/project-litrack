import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to School Setup → End-of-Term Subjects. Survives as a redirect
 * for bookmarks and release notes that link here; `?type=` carries over. Plain
 * `redirect()` (307), never `permanentRedirect()`, so browsers do not cache it
 * forever. The destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacyTermSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.termSubjects, await searchParams));
}
