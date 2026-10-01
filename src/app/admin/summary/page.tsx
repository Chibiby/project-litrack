import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to Monitoring → Division Summary. Survives as a redirect for
 * bookmarks; plain `redirect()` (307), never `permanentRedirect()`, so browsers
 * do not cache it forever. The destination guards itself (and sends a district
 * admin to their own summary).
 */
export const dynamic = "force-dynamic";

export default async function LegacySummaryPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.divisionSummary, await searchParams));
}
