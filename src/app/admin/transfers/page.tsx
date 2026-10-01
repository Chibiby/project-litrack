import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to School Setup → Learner Transfers. Survives as a redirect for
 * bookmarks; the query string carries over. Plain `redirect()` (307), never
 * `permanentRedirect()`, so browsers do not cache it forever. The destination
 * guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacyTransfersPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.learnerTransfers, await searchParams));
}
