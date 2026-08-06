import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { ExportControls } from "@/components/reports/export-controls";
import { PrintableLearnersReport } from "@/components/reports/printable-learners-report";
import { ReportPrintAudit } from "@/components/reports/report-print-audit";
import { loadLearnersForReport } from "@/lib/actions/export-learners";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ schoolId?: string }>;
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

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, deletedAt: null },
    select: { id: true, type: true },
    orderBy: { createdAt: "asc" },
  });

  const report = await loadLearnersForReport({ schoolId });

  return (
    <AppShell
      title="Reports"
      subtitle="Excel export and printable school learner summary"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={isSuperAdminView ? school?.name : undefined}
    >
      <ReportPrintAudit scope="SCHOOL_HEAD" schoolId={schoolId} />
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
    </AppShell>
  );
}
