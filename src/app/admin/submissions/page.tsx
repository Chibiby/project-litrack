import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to School Setup → Report Submissions. Survives as a redirect for
 * bookmarks; `?schoolId=` / `?schoolYearId=` carry over. Plain `redirect()`
 * (307), never `permanentRedirect()`, so browsers do not cache it forever. The
 * destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacySubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.reportSubmissions, await searchParams));
}
