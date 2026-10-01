import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to Monitoring → Support Inbox. Survives as a redirect because chat
 * notifications already delivered link here with `?tab=chat&channel=`, and
 * those carry over. Plain `redirect()` (307), never `permanentRedirect()`, so
 * browsers do not cache it forever. The destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacySupportPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.support, await searchParams));
}
