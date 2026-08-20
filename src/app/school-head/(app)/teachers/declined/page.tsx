import { Suspense } from "react";
import { UserX } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  TEACHER_ROSTER_STATE,
  teacherRosterScope,
  teacherTabCounts,
} from "@/lib/teachers/roster";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import {
  TeachersDeclinedTable,
  type DeclinedTeacherRow,
} from "@/components/teachers-active-table";
import { Surface, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface DeclinedTeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function DeclinedTeachersBody({ view }: { view: SchoolHeadView }) {
  const declinedTeachers = await prisma.user.findMany({
    where: {
      ...teacherRosterScope(view.schoolId),
      ...TEACHER_ROSTER_STATE.declined,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      rejectedAt: true,
    },
    orderBy: { rejectedAt: "desc" },
  });

  const declinedRows: DeclinedTeacherRow[] = declinedTeachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    rejectedAt: t.rejectedAt?.toISOString() ?? null,
  }));

  // `TeachersDeclinedTable` renders nothing when it has no rows — correct when
  // it was the last of four tables on one page, but a tab of its own cannot go
  // blank, so the empty case is answered here.
  if (declinedRows.length === 0) {
    return (
      <Surface as="section">
        <SurfaceBody>
          <EmptyState
            title="No declined requests"
            description="Registration requests you decline are kept here so you can let someone try again."
            icon={UserX}
          />
        </SurfaceBody>
      </Surface>
    );
  }

  return (
    <TeachersDeclinedTable rows={declinedRows} readOnly={view.isSuperAdminView} />
  );
}

export default async function DeclinedTeachersPage({
  searchParams,
}: DeclinedTeachersPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.teachersDeclined
  );

  const counts = await teacherTabCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Teachers"
      description="Requests you turned down. Clearing one lets that person register again."
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.declined}
    >
      <Suspense fallback={<TableSectionSkeleton rows={3} columns={4} />}>
        <DeclinedTeachersBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
