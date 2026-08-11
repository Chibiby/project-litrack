import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
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
      <Suspense fallback={<TableSectionSkeleton rows={12} columns={6} />}>
        <SchoolHeadReportBody schoolId={schoolId} />
      </Suspense>
    </AppShell>
  );
}
