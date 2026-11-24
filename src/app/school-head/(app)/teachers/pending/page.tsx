import { Suspense } from "react";
import { Users } from "lucide-react";
import { prismaFresh } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  TEACHER_ROSTER_STATE,
  teacherRosterScope,
  teacherTabCounts,
} from "@/lib/teachers/roster";
import { SchoolHeadPage } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import {
  TEACHER_TABS,
  teacherWorkspaceTabs,
} from "@/components/school-head/workspace-tabs";
import { Callout } from "@/components/ui/callout";
import {
  TeachersPendingTable,
  type PendingTeacherRow,
} from "@/components/teachers-pending-table";
import { TableSectionSkeleton } from "@/components/loading";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import { parseListPage } from "@/lib/nav/list-params";

const PENDING_PAGE_SIZE = 25;

export const dynamic = "force-dynamic";

interface PendingTeachersPageProps {
  searchParams: Promise<{ schoolId?: string; page?: string }>;
}

async function PendingTeachersBody({ view, page }: { view: SchoolHeadView; page: number }) {
  const where = {
    ...teacherRosterScope(view.schoolId),
    ...TEACHER_ROSTER_STATE.pending,
  };
  const [pendingTeachers, totalCount] = await Promise.all([
    prismaFresh.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PENDING_PAGE_SIZE,
      take: PENDING_PAGE_SIZE,
    }),
    prismaFresh.user.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PENDING_PAGE_SIZE));

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
      <Callout variant="info">
        Teachers self-register from the login page and verify their email once.
        Approving one lets them sign in with their email and password and pick
        their own grade and section during profiling — you can change that from
        the Active tab at any time.
      </Callout>

      {pendingRows.length === 0 && totalCount > 0 ? (
        <PageOutOfRangeState
          basePath={SCHOOL_HEAD_ROUTES.teachersPending}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          noun="registration requests"
        />
      ) : (
        <TeachersPendingTable rows={pendingRows} readOnly={view.isSuperAdminView} />
      )}
      {totalPages > 1 ? (
        <ListPager
          basePath={SCHOOL_HEAD_ROUTES.teachersPending}
          page={page}
          pageSize={PENDING_PAGE_SIZE}
          totalPages={totalPages}
          totalCount={totalCount}
          noun="requests"
        />
      ) : null}
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
      view={view}
      tabs={teacherWorkspaceTabs(counts)}
      activeTab={TEACHER_TABS.pending}
      hero={
        <SchoolHeadHero
          eyebrow="Staff"
          eyebrowIcon={Users}
          title="Teachers"
          subtitle="Registration requests waiting on your decision."
        />
      }
    >
      <Suspense fallback={<TableSectionSkeleton rows={4} columns={4} />}>
        <PendingTeachersBody view={view} page={parseListPage(params.page)} />
      </Suspense>
    </SchoolHeadPage>
  );
}
