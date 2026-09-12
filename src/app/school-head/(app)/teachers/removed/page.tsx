import { Suspense } from "react";
import { UserMinus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import { removedTeacherScope, teacherTabCounts } from "@/lib/teachers/roster";
import { originalTeacherEmail } from "@/lib/teachers/removed-email";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import {
  TeachersRemovedTable,
  type RemovedTeacherRow,
} from "@/components/teachers-active-table";
import { Surface, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface RemovedTeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function RemovedTeachersBody({ view }: { view: SchoolHeadView }) {
  const removedTeachers = await prisma.user.findMany({
    where: removedTeacherScope(view.schoolId),
    select: { id: true, fullName: true, email: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });

  const rows: RemovedTeacherRow[] = removedTeachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    email: originalTeacherEmail(t.email),
    // Non-null by the scope; the fallback only satisfies the type.
    removedAt: (t.deletedAt ?? new Date()).toISOString(),
  }));

  if (rows.length === 0) {
    return (
      <Surface as="section">
        <SurfaceBody>
          <EmptyState
            title="No removed teachers"
            description="Teachers you remove are listed here. Their advisory sections become Unassigned when they go."
            icon={UserMinus}
          />
        </SurfaceBody>
      </Surface>
    );
  }

  return <TeachersRemovedTable rows={rows} />;
}

export default async function RemovedTeachersPage({
  searchParams,
}: RemovedTeachersPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.teachersRemoved
  );

  const counts = await teacherTabCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Teachers"
      description="Teachers removed from this school. Their logins are deleted; to come back, they register again."
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.removed}
    >
      <Suspense fallback={<TableSectionSkeleton rows={4} columns={3} />}>
        <RemovedTeachersBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
