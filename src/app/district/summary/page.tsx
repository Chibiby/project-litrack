import { BarChart3 } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { AppShell } from "@/components/app-shell";
import { PageSlide } from "@/components/ui/page-slide";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";
import { describeScope } from "@/components/district/scope-label";
import { DISTRICT_SUMMARY_GROUPS, SUMMARY_FACET_META } from "@/lib/summary/facet-meta";

export const dynamic = "force-dynamic";

export default async function DistrictSummaryIndexPage() {
  const { user, scope } = await requireAdminScope();

  return (
    <AppShell
      title="District Summary"
      subtitle="Learners, reading and compliance across your schools"
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <PageSlide side="parent">
        <div className="mb-6">
          <SchoolHeadHero
            eyebrow="District summary"
            eyebrowIcon={BarChart3}
            title="District Summary"
            subtitle="Learners, reading and compliance across your schools, overall and by school."
            meta={describeScope(scope)}
          />
        </div>
        <div className="space-y-6">
          {DISTRICT_SUMMARY_GROUPS.map((group, i) => (
            <section key={group.label} aria-labelledby={`summary-group-${i}`} className="min-w-0">
              <h2
                id={`summary-group-${i}`}
                className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.label}
              </h2>
              <SummaryFacetIndex
                basePath="/district/summary"
                facets={group.facetIds.map((id) => SUMMARY_FACET_META[id])}
              />
            </section>
          ))}
        </div>
      </PageSlide>
    </AppShell>
  );
}
