import { Suspense } from "react";
import { TriangleAlert } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import { getDiscrepancySummary } from "@/lib/monitoring/discrepancies";
import type { DiscrepancySummary } from "@/lib/monitoring/discrepancy-kinds";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { DiscrepancyList } from "@/components/school-head/monitoring/discrepancy-list";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function Body({ view }: { view: SchoolHeadView }) {
  let summary: DiscrepancySummary;
  try {
    summary = await getDiscrepancySummary(view.schoolId);
  } catch (err) {
    console.error("[MonitoringDiscrepancies] failed to load:", err);
    return (
      <p className="text-sm text-destructive">
        Could not load discrepancies right now. The database may be unavailable. Reload the page to try again.
      </p>
    );
  }
  return (
    <DiscrepancyList
      summary={summary}
      learnersHref={(name) =>
        schoolHeadHref(view, `${SCHOOL_HEAD_ROUTES.learners}?q=${encodeURIComponent(name.split(",")[0] ?? name)}`)
      }
      setupHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.schoolGradeLevels)}
      aralHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.monitoringAral)}
    />
  );
}

/** Learner and section records that do not add up, with how to fix each. */
export default async function MonitoringDiscrepanciesPage({ searchParams }: PageProps) {
  const { schoolId } = await searchParams;
  const { view } = await resolveSchoolHeadView(schoolId, SCHOOL_HEAD_ROUTES.monitoringDiscrepancies);
  return (
    <SchoolHeadPage
      title="Discrepancies"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="Monitoring"
          eyebrowIcon={TriangleAlert}
          title="Discrepancies"
          subtitle="Learners with no adviser or section, ARAL learners with no ARAL tutor, enrollments that do not match, and sections without an adviser."
        />
      }
    >
      <Suspense
        fallback={
          <div className="space-y-4">
            <MetricsGridSkeleton className="mb-0" count={5} />
            <TableSectionSkeleton rows={8} columns={3} />
          </div>
        }
      >
        <Body view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
