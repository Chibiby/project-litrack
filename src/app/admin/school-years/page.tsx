import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to School Year Setup → School Years. Survives as a redirect for
 * bookmarks; plain `redirect()` (307), never `permanentRedirect()`, so browsers
 * do not cache it forever. The destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacySchoolYearsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.schoolYears, await searchParams));
}
