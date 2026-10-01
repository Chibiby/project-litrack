import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * The oldest home of the submissions console; now School Setup → Report
 * Submissions. Plain `redirect()` (307), never `permanentRedirect()`, so
 * browsers do not cache it forever. The destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacySubmissionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.reportSubmissions, await searchParams));
}
