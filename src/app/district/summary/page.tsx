import { BarChart3 } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";
import { describeScope } from "@/components/district/scope-label";

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
      <div className="mb-6">
        <SchoolHeadHero
          eyebrow="District summary"
          eyebrowIcon={BarChart3}
          title="District Summary"
          subtitle="Learners, reading and compliance across your schools, overall and by school."
          meta={describeScope(scope)}
        />
      </div>
      <SummaryFacetIndex basePath="/district/summary" />
    </AppShell>
  );
}
