import { Suspense } from "react";
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
  TeachersPendingTable,
  type PendingTeacherRow,
} from "@/components/teachers-pending-table";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface PendingTeachersPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function PendingTeachersBody({ view }: { view: SchoolHeadView }) {
  const pendingTeachers = await prisma.user.findMany({
    where: {
      ...teacherRosterScope(view.schoolId),
      ...TEACHER_ROSTER_STATE.pending,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const pendingRows: PendingTeacherRow[] = pendingTeachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    requestedAt: t.createdAt.toISOString(),
  }));

  return (
    <>
      {/* The one place the registration flow needs explaining is the tab where
          you act on it. */}
      <p className="text-sm text-muted-foreground">
        Teachers self-register from the login page and verify their email once.
        Approving one lets them sign in with their email and password and pick
        their own grade and section during profiling — you can change that from
        the Active tab at any time.
      </p>

      <TeachersPendingTable rows={pendingRows} readOnly={view.isSuperAdminView} />
    </>
  );
}

export default async function PendingTeachersPage({
  searchParams,
}: PendingTeachersPageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.teachersPending
  );

  const counts = await teacherTabCounts(view.schoolId);

  return (
    <SchoolHeadPage
      title="Teachers"
      description="Registration requests waiting on your decision."
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.pending}
    >
      <Suspense fallback={<TableSectionSkeleton rows={4} columns={4} />}>
        <PendingTeachersBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
