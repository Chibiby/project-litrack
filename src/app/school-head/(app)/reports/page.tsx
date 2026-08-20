import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { OnDemandReportPanel } from "@/components/reports/on-demand-report-panel";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ schoolId?: string }>;
}

async function SchoolHeadReportBody({ schoolId }: { schoolId: string }) {
  // Filters only — full school learner dump loads on demand.
  const [grades, sections] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.section.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true, gradeLevelId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <OnDemandReportPanel
      role="SCHOOL_HEAD"
      schoolId={schoolId}
      grades={grades.map((g) => ({
        id: g.id,
        label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
      }))}
      sections={sections}
      subtitle="School-wide"
    />
  );
}

export default async function SchoolHeadReportsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.reports
  );

  return (
    <SchoolHeadPage
      title="Reports"
      description="Filter the school roster, then download it as Excel or open a printable summary."
      view={view}
    >
      <Suspense fallback={<TableSectionSkeleton rows={12} columns={6} />}>
        <SchoolHeadReportBody schoolId={view.schoolId} />
      </Suspense>
    </SchoolHeadPage>
  );
}
