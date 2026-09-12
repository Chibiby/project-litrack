import { Suspense } from "react";
import Link from "next/link";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { Button } from "@/components/ui/button";
import {
  SchoolHeadMetricsSection,
  SchoolHeadChartsSection,
  SchoolHeadRecentActivitySection,
} from "@/components/dashboard/school-head-dashboard-sections";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  DualListCardSkeleton,
} from "@/components/loading";
import { ArrowRightLeft, Megaphone } from "lucide-react";
import { getAdviserlessSections } from "@/lib/teachers/adviserless";
import { AdviserlessSectionsNotice } from "@/components/school-head/adviserless-sections-notice";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadDashboard({
  searchParams,
}: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const { user, view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.dashboard
  );
  const adviserlessSections = await getAdviserlessSections(view.schoolId);

  return (
    <SchoolHeadPage
      // The frame names the viewed school in its own badge, so a Super Admin
      // drilling in does not need it repeated in the heading.
      title={view.isSuperAdminView ? "Dashboard" : `Welcome, ${user.firstName}`}
      description="Enrollment, ARAL progress, and recent activity at a glance."
      view={view}
      actions={
        view.isSuperAdminView ? undefined : (
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={SCHOOL_HEAD_ROUTES.announcements}>
                <Megaphone className="mr-1 h-4 w-4" aria-hidden /> Post an
                announcement
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={SCHOOL_HEAD_ROUTES.transfer}>
                <ArrowRightLeft className="mr-1 h-4 w-4" aria-hidden /> Transfer
                a learner
              </Link>
            </Button>
          </>
        )
      }
    >
      <AdviserlessSectionsNotice sections={adviserlessSections} />

      <Suspense fallback={<MetricsGridSkeleton variant="school-head" />}>
        <SchoolHeadMetricsSection
          schoolId={view.schoolId}
          isSuperAdminView={view.isSuperAdminView}
        />
      </Suspense>

      <Suspense
        fallback={
          <>
            <ChartSectionSkeleton columns={2} />
            <ChartSectionSkeleton columns={2} />
          </>
        }
      >
        <SchoolHeadChartsSection schoolId={view.schoolId} />
      </Suspense>

      <Suspense fallback={<DualListCardSkeleton />}>
        <SchoolHeadRecentActivitySection
          schoolId={view.schoolId}
          isSuperAdminView={view.isSuperAdminView}
        />
      </Suspense>
    </SchoolHeadPage>
  );
}
