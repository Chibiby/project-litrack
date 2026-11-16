import { BarChart3 } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { AppShell } from "@/components/app-shell";
import { PageSlide } from "@/components/ui/page-slide";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";
import { describeScope } from "@/components/district/scope-label";
import { DISTRICT_ROUTES } from "@/lib/routes/district";

export const dynamic = "force-dynamic";

export default async function DistrictSummaryIndexPage() {
  const { user, scope } = await requireAdminScope();

  return (
    <AppShell
      title="District Summary"
      subtitle="Every school in your districts, overall and by school"
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
            subtitle="Every school in your districts, overall and by school."
            meta={describeScope(scope)}
          />
        </div>
        {/* Same flat card grid as the Division Summary. */}
        <SummaryFacetIndex basePath={DISTRICT_ROUTES.summaryIndex} />
      </PageSlide>
    </AppShell>
  );
}
