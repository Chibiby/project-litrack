import { redirect } from "next/navigation";
import { ADMIN_ROUTES, withSearchParams, type PageSearchParams } from "@/lib/routes/admin";

/**
 * A summary facet moved under Monitoring → Division Summary. Survives as a
 * redirect because facet views (with their level/district/month filters) are
 * bookmarked and shared; the query string carries over. Plain `redirect()`
 * (307), never `permanentRedirect()`, so browsers do not cache it forever. The
 * destination validates the facet and guards itself.
 */
export const dynamic = "force-dynamic";

export default async function LegacySummaryFacetPage({
  params,
  searchParams,
}: {
  params: Promise<{ facet: string }>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { facet } = await params;
  redirect(
    withSearchParams(ADMIN_ROUTES.divisionSummaryFacet(encodeURIComponent(facet)), await searchParams)
  );
}
