import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { ExportControls } from "@/components/reports/export-controls";
import { PrintableLearnersReport } from "@/components/reports/printable-learners-report";
import { ReportPrintAudit } from "@/components/reports/report-print-audit";
import { loadLearnersForReport } from "@/lib/actions/export-learners";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

async function TeacherReportBody({
  schoolId,
  teacherId,
  isTeacher,
}: {
  schoolId: string;
  teacherId: string;
  isTeacher: boolean;
}) {
  const [grades, report] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: isTeacher
        ? { schoolId, deletedAt: null, teachers: { some: { id: teacherId } } }
        : { schoolId, deletedAt: null },
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    loadLearnersForReport({
      schoolId,
      teacherId: isTeacher ? teacherId : undefined,
    }),
  ]);

  return (
    <>
      <div className="mb-4 space-y-4">
        <ExportControls
          role="TEACHER"
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
          subtitle="Teacher assigned grades"
        />
      </div>
    </>
  );
}

export default async function TeacherReportsPage() {
  const user = await requireUser("TEACHER");
  if (!user.schoolId) redirect("/login");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") {
    redirect("/teacher/profiling");
  }

  const schoolId = user.schoolId;
  const isTeacher = user.role === "TEACHER";

  return (
    <AppShell
      title="Reports"
      subtitle="Excel export and printable learner summary"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <ReportPrintAudit scope="TEACHER" schoolId={schoolId} />
      <Suspense fallback={<TableSectionSkeleton rows={12} columns={6} />}>
        <TeacherReportBody
          schoolId={schoolId}
          teacherId={user.id}
          isTeacher={isTeacher}
        />
      </Suspense>
    </AppShell>
  );
}
