import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to Monitoring → Deleted Records, which holds deleted teachers and
 * deleted learners together. Survives as a redirect for bookmarks; plain
 * `redirect()` (307), never `permanentRedirect()`. The destination guards
 * itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacyDeletedRecordsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  // The old archive's learner pager and sort do not carry over.
  redirect(withSearchParams(ADMIN_ROUTES.deletedRecords, await searchParams, ["learners", "learnersSort"]));
}
