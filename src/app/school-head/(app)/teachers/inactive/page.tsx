import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  TEACHER_ROSTER_STATE,
  managedTeacherSelect,
  teacherRosterScope,
  teacherTabCounts,
  toManagedRow,
} from "@/lib/teachers/roster";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import {
  TeachersInactiveTable,
  type ActiveTeacherRow,
} from "@/components/teachers-active-table";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface InactiveTeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function InactiveTeachersBody({ view }: { view: SchoolHeadView }) {
  const inactiveTeachers = await prisma.user.findMany({
    where: {
      ...teacherRosterScope(view.schoolId),
      ...TEACHER_ROSTER_STATE.inactive,
    },
    select: managedTeacherSelect,
    orderBy: { createdAt: "desc" },
  });

  const inactiveRows: ActiveTeacherRow[] = inactiveTeachers.map(toManagedRow);

  // The table shows each teacher's learner counts, which is the point of this
  // panel: deactivating does not hand their learners to anyone else.
  return (
    <TeachersInactiveTable rows={inactiveRows} readOnly={view.isSuperAdminView} />
  );
}

export default async function InactiveTeachersPage({
  searchParams,
}: InactiveTeachersPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.teachersInactive
  );

  const counts = await teacherTabCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Teachers"
      description="Approved teachers who cannot sign in right now. Reactivate one to restore access."
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.inactive}
    >
      <Suspense fallback={<TableSectionSkeleton rows={4} columns={7} />}>
        <InactiveTeachersBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
