import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  ReportsHub,
  ReportSettingsButton,
} from "@/components/reports/reports-hub";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { loadRecentReports } from "@/lib/reports/recent";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ schoolId?: string }>;
}

async function SchoolHeadReportBody({
  schoolId,
  userId,
}: {
  schoolId: string;
  userId: string;
}) {
  // Filters and history only — every report is generated on demand, so opening
  // this page never dumps the school roster.
  const [grades, sections, schoolYears, recent] = await Promise.all([
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
    prisma.schoolYear.findMany({
      where: { schoolId },
      select: { id: true, label: true },
      orderBy: { startDate: "desc" },
    }),
    loadRecentReports({ schoolId, createdById: userId }),
  ]);

  return (
    <ReportsHub
      schoolYears={schoolYears.map((y) => ({ id: y.id, label: y.label }))}
      grades={grades.map((g) => ({
        id: g.id,
        label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
      }))}
      sections={sections.map((s) => ({
        id: s.id,
        label: s.name,
        gradeLevelId: s.gradeLevelId,
      }))}
      recent={recent}
      canDelete
    />
  );
}

export default async function SchoolHeadReportsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.reports
  );
  const user = await requireUser(["SCHOOL_HEAD"]);

  return (
    <SchoolHeadPage
      title="Reports Hub"
      description="Generate, view and download reports for the school."
      view={view}
      actions={<ReportSettingsButton />}
    >
      <Suspense fallback={<TableSectionSkeleton rows={12} columns={6} />}>
        <SchoolHeadReportBody schoolId={view.schoolId} userId={user.id} />
      </Suspense>
    </SchoolHeadPage>
  );
}
