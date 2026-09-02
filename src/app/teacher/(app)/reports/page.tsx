import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import {
  ReportsHub,
  ReportSettingsButton,
} from "@/components/reports/reports-hub";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { teacherGradeScope } from "@/lib/teachers/scope";
import { loadRecentReports } from "@/lib/reports/recent";
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
  // Matches the export gate in `exportTeacherLearnersExcel`: grades this
  // teacher advises in, plus grades where they track ARAL learners.
  const gradeWhere: Prisma.GradeLevelWhereInput = isTeacher
    ? { schoolId, deletedAt: null, ...teacherGradeScope(teacherId) }
    : { schoolId, deletedAt: null };

  // Filters and history only. No learner rows load here — every report is
  // generated on demand, so opening this page never dumps a roster.
  const [grades, sections, schoolYears, recent] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: gradeWhere,
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.section.findMany({
      where: { schoolId, deletedAt: null, gradeLevel: gradeWhere },
      select: { id: true, name: true, gradeLevelId: true },
      orderBy: { name: "asc" },
    }),
    prisma.schoolYear.findMany({
      where: { schoolId },
      select: { id: true, label: true },
      orderBy: { startDate: "desc" },
    }),
    loadRecentReports({ schoolId, createdById: teacherId }),
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
      title="Reports Hub"
      subtitle="Generate, view and download reports for your classes and subjects."
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      actions={<ReportSettingsButton />}
    >
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
