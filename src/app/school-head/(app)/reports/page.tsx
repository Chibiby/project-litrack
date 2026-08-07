import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { ExportControls } from "@/components/reports/lazy-export-controls";
import { PrintableLearnersReport } from "@/components/reports/printable-learners-report";
import { ReportPrintAudit } from "@/components/reports/report-print-audit";
import { loadLearnersForReport } from "@/lib/actions/export-learners";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ schoolId?: string }>;
}

async function SchoolHeadReportBody({ schoolId }: { schoolId: string }) {
  const [grades, report] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    loadLearnersForReport({ schoolId }),
  ]);

  return (
    <>
      <div className="mb-4 space-y-4">
        <ExportControls
          role="SCHOOL_HEAD"
          schoolId={schoolId}
          grades={grades.map((g) => ({
            id: g.id,
            label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
          }))}
        />
      </div>
      <div className="rounded-xl border border-border bg-card p-6 print:border-0 print:p-0">
        <PrintableLearnersReport
          schoolName={report.schoolName}
          generatedAt={report.generatedAt}
          learners={report.learners}
          aralCount={report.aralCount}
          byGrade={report.byGrade}
          subtitle="School-wide"
        />
      </div>
    </>
  );
}

export default async function SchoolHeadReportsPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");

  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") {
    redirect("/school-head/profiling");
  }

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/reports"
  );

  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title="Reports"
      subtitle="Excel export and printable school learner summary"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={isSuperAdminView ? (schoolName ?? undefined) : undefined}
    >
      <ReportPrintAudit scope="SCHOOL_HEAD" schoolId={schoolId} />
      <Suspense fallback={<TableSectionSkeleton rows={12} columns={6} />}>
        <SchoolHeadReportBody schoolId={schoolId} />
      </Suspense>
    </AppShell>
  );
}
