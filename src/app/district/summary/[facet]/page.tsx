import { notFound } from "next/navigation";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { SUMMARY_FACET_META, isSummaryFacetId } from "@/lib/summary/facet-meta";
import { AppShell } from "@/components/app-shell";
import { SummaryFacetView } from "@/components/summary/summary-facet-view";
import { SummaryPageHero } from "@/components/summary/summary-page-hero";
import { describeScope } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

export default async function DistrictSummaryFacetPage({
  params,
  searchParams,
}: {
  params: Promise<{ facet: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, scope } = await requireAdminScope();
  const { facet } = await params;
  if (!isSummaryFacetId(facet)) notFound();

  const meta = SUMMARY_FACET_META[facet];
  return (
    <AppShell
      title={meta.label}
      subtitle={meta.description}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        <SummaryPageHero facetId={facet} portal="district" meta={describeScope(scope)} />
      </div>
      <SummaryFacetView
        facetId={facet}
        adminScope={scope}
        searchParams={await searchParams}
        basePath="/district/summary"
        userId={user.id}
      />
    </AppShell>
  );
}
