import { Suspense } from "react";
import { UserCheck, Users } from "lucide-react";
import { prismaFresh } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  TEACHER_ROSTER_STATE,
  managedTeacherSelect,
  teacherRosterScope,
  teacherTabCounts,
  toManagedRow,
} from "@/lib/teachers/roster";
import {
  SchoolHeadPage,
  schoolHeadHref,
} from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import {
  TeachersInactiveTable,
  type ActiveTeacherRow,
} from "@/components/teachers-active-table";
import { Surface, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface InactiveTeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function InactiveTeachersBody({ view }: { view: SchoolHeadView }) {
  const inactiveTeachers = await prismaFresh.user.findMany({
    where: {
      ...teacherRosterScope(view.schoolId),
      ...TEACHER_ROSTER_STATE.inactive,
    },
    select: managedTeacherSelect,
    orderBy: { createdAt: "desc" },
  });

  const inactiveRows: ActiveTeacherRow[] = inactiveTeachers.map(toManagedRow);

  if (inactiveRows.length === 0) {
    return (
      <Surface as="section">
        <SurfaceBody>
          <EmptyState
            title="No inactive teachers"
            description="Every approved teacher can currently sign in. Deactivate one from the Active tab to pause their access."
            icon={UserCheck}
            actionHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.teachers)}
            actionLabel="View active teachers"
          />
        </SurfaceBody>
      </Surface>
    );
  }

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
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.inactive}
      hero={
        <SchoolHeadHero
          eyebrow="Staff"
          eyebrowIcon={Users}
          title="Teachers"
          subtitle="Approved teachers who cannot sign in right now. Reactivate one to restore access."
        />
      }
    >
      <Suspense fallback={<TableSectionSkeleton rows={4} columns={7} />}>
        <InactiveTeachersBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
