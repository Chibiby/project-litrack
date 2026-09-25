import { notFound, redirect } from "next/navigation";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { SUMMARY_FACET_META, isSummaryFacetId } from "@/lib/summary/facet-meta";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { SummaryFacetView } from "@/components/summary/summary-facet-view";
import { SummaryPageHero } from "@/components/summary/summary-page-hero";

export const dynamic = "force-dynamic";

export default async function AdminSummaryFacetPage({
  params,
  searchParams,
}: {
  params: Promise<{ facet: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, scope } = await requireAdminScope();
  const { facet } = await params;
  if (!isSummaryFacetId(facet)) notFound();
  // A district admin's summary lives under /district; middleware normally
  // sends them there first, but it is not the authoritative gate.
  if (user.role !== "SUPER_ADMIN") redirect(DISTRICT_ROUTES.summary(facet));

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
        <SummaryPageHero facetId={facet} portal="division" meta="Every school in the division" />
      </div>
      <SummaryFacetView
        facetId={facet}
        adminScope={scope}
        searchParams={await searchParams}
        basePath="/admin/summary"
        userId={user.id}
      />
    </AppShell>
  );
}
