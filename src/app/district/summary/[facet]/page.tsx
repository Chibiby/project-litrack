import { notFound, redirect } from "next/navigation";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { SUMMARY_FACET_META, isSummaryFacetId } from "@/lib/summary/facet-meta";
import { AppShell } from "@/components/app-shell";
import { PageSlide } from "@/components/ui/page-slide";
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

  // A district admin's summary is overall or by school only, so an old link's
  // `level=district` is dropped. `district=` is dropped too for an admin with
  // one district: the page shows no District filter to undo it.
  const search = await searchParams;
  const dropDistrict =
    search.district !== undefined && scope.kind === "districts" && scope.districts.length <= 1;
  if (search.level === "district" || dropDistrict) {
    const kept = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if ((key === "district" && dropDistrict) || (key === "level" && value === "district")) continue;
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) kept.append(key, v);
    }
    const qs = kept.toString();
    redirect(`/district/summary/${facet}${qs ? `?${qs}` : ""}`);
  }

  const meta = SUMMARY_FACET_META[facet];
  return (
    <AppShell
      title={meta.label}
      subtitle={meta.description}
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <PageSlide side="child">
        <div className="mb-6">
          <SummaryPageHero
            facetId={facet}
            portal="district"
            meta={describeScope(scope)}
          />
        </div>
        <SummaryFacetView
          facetId={facet}
          adminScope={scope}
          searchParams={search}
          basePath="/district/summary"
          userId={user.id}
        />
      </PageSlide>
    </AppShell>
  );
}
