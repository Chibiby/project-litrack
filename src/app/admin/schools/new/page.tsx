import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * Moved to Management → Schools → New. Survives as a redirect for bookmarks
 * and printed docs; plain `redirect()` (307), never `permanentRedirect()`, so
 * browsers do not cache it forever. The destination guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacyNewSchoolPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  redirect(withSearchParams(ADMIN_ROUTES.newSchool, await searchParams));
}
