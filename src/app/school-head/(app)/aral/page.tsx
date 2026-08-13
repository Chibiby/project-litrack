import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  LEARNER_PAGE_SIZE,
  nameSearchWhere,
  totalPages,
} from "@/lib/learners/pagination";
import {
  AralTeacherTable,
  type AralLearnerRow,
  type AralTeacherOption,
} from "@/components/school-head/aral-teacher-table";
import { TableSectionSkeleton } from "@/components/loading";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string; page?: string; q?: string }>;
}

/** Parsed inline — this page only needs page + q, not the roster filter set. */
function parseParams(searchParams: { page?: string; q?: string }) {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return {
    page,
    q: (searchParams.q ?? "").trim(),
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  };
}

async function AralBody({
  schoolId,
  isSuperAdminView,
  params,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
  params: ReturnType<typeof parseParams>;
}) {
  const learnerWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    isAralLearner: true,
    ...nameSearchWhere(params.q),
  };

  const [learners, learnerCount, teachers] = await Promise.all([
    prisma.learner.findMany({
      where: learnerWhere,
      select: {
        id: true,
        fullName: true,
        aralTeacherId: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        teacher: { select: { fullName: true } },
      },
      orderBy: { fullName: "asc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.learner.count({ where: learnerWhere }),
    // The whole active roster: an ARAL-only teacher (no advisory section) is a
    // valid designee, so this must not be narrowed to advisers.
    prisma.user.findMany({
      where: {
        schoolId,
        role: "TEACHER",
        deletedAt: null,
        isActive: true,
        approvalStatus: "APPROVED",
      },
      select: {
        id: true,
        fullName: true,
        advisorySection: {
          select: {
            name: true,
            deletedAt: true,
            gradeLevel: { select: { type: true } },
          },
        },
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const rows: AralLearnerRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type],
    sectionName: l.section?.name ?? null,
    adviserName: l.teacher?.fullName ?? null,
    aralTeacherId: l.aralTeacherId,
  }));

  const teacherOptions: AralTeacherOption[] = teachers.map((t) => {
    const advisory =
      t.advisorySection && t.advisorySection.deletedAt === null
        ? t.advisorySection
        : null;
    return {
      id: t.id,
      fullName: t.fullName,
      advisoryLabel: advisory
        ? `${GRADE_LEVEL_LABELS[advisory.gradeLevel.type]}-${advisory.name}`
        : null,
    };
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        ARAL learners are the learners whose reading and writing are tracked
        weekly. Their ARAL teacher is independent of who advises their section —
        designate any active teacher, including one who advises no section at all.
        Reassign here before removing a teacher who still holds ARAL learners.
      </p>

      {teacherOptions.length === 0 && !isSuperAdminView ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active teachers yet — approve a teacher before designating ARAL
          teachers.
        </div>
      ) : null}

      <AralTeacherTable
        rows={rows}
        teachers={teacherOptions}
        readOnly={isSuperAdminView}
        list={{
          page: params.page,
          totalPages: totalPages(learnerCount),
          totalCount: learnerCount,
          q: params.q,
          basePath: "/school-head/aral",
          searchParams: {
            schoolId: isSuperAdminView ? schoolId : undefined,
            q: params.q || undefined,
          },
        }}
      />
    </div>
  );
}

export default async function SchoolHeadAralPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") {
    redirect("/school-head/profiling");
  }

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    raw.schoolId,
    "/school-head/aral"
  );

  const params = parseParams(raw);
  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title={isSuperAdminView ? `ARAL — ${schoolName ?? ""}` : "ARAL learners"}
      subtitle={
        isSuperAdminView
          ? "Super Admin View"
          : "Designate the teacher who tracks each ARAL learner weekly"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<TableSectionSkeleton rows={8} columns={5} />}>
        <AralBody
          schoolId={schoolId}
          isSuperAdminView={isSuperAdminView}
          params={params}
        />
      </Suspense>
    </AppShell>
  );
}
