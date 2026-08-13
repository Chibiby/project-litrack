import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { OnDemandReportPanel } from "@/components/reports/on-demand-report-panel";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { teacherGradeScope } from "@/lib/teachers/scope";
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

  // Filters only — full learner dump loads on demand via OnDemandReportPanel.
  const [grades, sections] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: gradeWhere,
      select: { id: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.section.findMany({
      where: {
        schoolId,
        deletedAt: null,
        gradeLevel: gradeWhere,
      },
      select: { id: true, name: true, gradeLevelId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <OnDemandReportPanel
      role="TEACHER"
      schoolId={schoolId}
      grades={grades.map((g) => ({
        id: g.id,
        label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
      }))}
      sections={sections}
      subtitle="Teacher assigned grades"
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
      title="Reports"
      subtitle="Excel export and printable learner summary"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
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
