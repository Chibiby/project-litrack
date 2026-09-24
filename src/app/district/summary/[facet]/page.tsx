import { notFound } from "next/navigation";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { SUMMARY_FACET_META, isSummaryFacetId } from "@/lib/summary/facet-meta";
import { AppShell } from "@/components/app-shell";
import { SummaryFacetView } from "@/components/summary/summary-facet-view";

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
    >
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
