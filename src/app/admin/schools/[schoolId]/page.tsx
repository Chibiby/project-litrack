import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * A school's detail page moved under Management → Schools. Survives as a
 * redirect because school links are shared and bookmarked; the tab and filter
 * query carry over. Plain `redirect()` (307), never `permanentRedirect()`, so
 * browsers do not cache it forever. The destination guards itself and checks
 * the school exists, so this discloses nothing.
 */
export const dynamic = "force-dynamic";

export default async function LegacySchoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { schoolId } = await params;
  redirect(withSearchParams(ADMIN_ROUTES.school(encodeURIComponent(schoolId)), await searchParams));
}
