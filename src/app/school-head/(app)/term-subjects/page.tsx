import { Suspense } from "react";
import { ListOrdered } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTermSubjects } from "@/lib/actions/term-subjects";
import { TermSubjectsGradePicker } from "@/components/school-head/term-subjects-grade-picker";
import { TermSubjectsManager } from "@/components/school-head/term-subjects-manager";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string; grade?: string }>;
}

async function TermSubjectsBody({
  view,
  gradeParam,
}: {
  view: SchoolHeadView;
  gradeParam?: string;
}) {
  // FLOATING carries no End of Terms sheet — see `FLOATING_GRADE` in the
  // actions module — so it is not offered as something to configure.
  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId: view.schoolId, deletedAt: null, type: { not: "FLOATING" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true },
  });

  if (grades.length === 0) {
    return (
      <EmptyState
        icon={ListOrdered}
        title="No grades yet"
        description="Activate a grade level in School workspace first, then come back to set its subjects."
      />
    );
  }

  const gradeOptions = grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));
  const selected =
    gradeOptions.find((g) => g.id === gradeParam) ?? gradeOptions[0];

  const res = await getTermSubjects({ gradeLevelId: selected.id });
  if (!res.ok) {
    return (
      <EmptyState
        icon={ListOrdered}
        title="Could not load subjects"
        description={res.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <TermSubjectsGradePicker
        grades={gradeOptions}
        selectedGradeId={selected.id}
        schoolIdParam={view.isSuperAdminView ? view.schoolId : undefined}
      />
      <TermSubjectsManager
        // Remount on grade switch: the manager holds active/archived in
        // `useOptimistic` state seeded once from props, and a new grade's rows
        // must replace it rather than merge into it.
        key={selected.id}
        gradeLevelId={selected.id}
        gradeLabel={selected.label}
        max={res.data.max}
        initialActive={res.data.active}
        initialArchived={res.data.archived}
      />
    </div>
  );
}

export default async function TermSubjectsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const { view } = await resolveSchoolHeadView(
    sp.schoolId,
    SCHOOL_HEAD_ROUTES.termSubjects
  );

  return (
    <SchoolHeadPage
      title="Term Subjects"
      description="Set which subjects appear on each grade's End of Terms sheet."
      view={view}
      superAdminCaption="editable — every change is audited"
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <TermSubjectsBody view={view} gradeParam={sp.grade} />
      </Suspense>
    </SchoolHeadPage>
  );
}
