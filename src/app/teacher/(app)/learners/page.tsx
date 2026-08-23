import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import {
  LearnerListClient,
  type LearnerListRow,
} from "@/components/learners/learner-list-client";
import { LearnerStatCards } from "@/components/learners/learner-stat-cards";
import {
  LearnerAddMenu,
  LearnerAddMenuDisabled,
} from "@/components/learners/learner-add-menu";
import { EmptyState } from "@/components/dashboard";
import {
  LearnerStatCardsSkeleton,
  LearnerTableSkeleton,
} from "@/components/learners/learner-roster-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellContext } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import {
  deniesAdvisoryRoster,
  teacherGradeScope,
  teacherLearnerScope,
} from "@/lib/teachers/scope";
import {
  getAdvisoryPlacement,
  NO_ADVISORY_MESSAGE,
} from "@/lib/teachers/advisory";
import {
  aralStatusWhere,
  genderWhere,
  gradeLevelIdWhere,
  nameSearchWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  totalPages,
  type LearnerListGradeFilter,
} from "@/lib/learners/pagination";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface TeacherLearnersPageProps {
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    perPage?: string;
    q?: string;
    filter?: string;
    sort?: string;
    grade?: string;
    gender?: string;
    aralStatus?: string;
  }>;
}

function learnerListWhere(opts: {
  assignedGradeIds: string[];
  teacherId: string;
  isSuperAdmin: boolean;
  list: ReturnType<typeof parseLearnerListParams>;
}): Prisma.LearnerWhereInput {
  const { assignedGradeIds, teacherId, isSuperAdmin, list } = opts;
  const where: Prisma.LearnerWhereInput = {
    ...gradeLevelIdWhere(list.grade, assignedGradeIds),
    deletedAt: null,
    // Learners in this teacher's care: advisory roster + ARAL designations.
    ...(isSuperAdmin ? {} : teacherLearnerScope(teacherId)),
    ...genderWhere(list.gender),
    ...aralStatusWhere(list.aralStatus),
    ...nameSearchWhere(list.q),
  };

  if (list.filter === "archived") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    // `?filter=aral` is a legacy entry point that narrows the same column the
    // ARAL facet does. Applying it unconditionally would silently overrule an
    // explicit "Not enrolled" into an empty list, so the facet wins.
    if (list.filter === "aral" && list.aralStatus === "all") {
      where.isAralLearner = true;
    }
  }

  return where;
}

/**
 * The add control needs the teacher's advisory section, which the header should
 * not block on — it streams in beside the title while the heading paints at once.
 *
 * Reads the placement from the same helper `createLearner` uses, so the dialog
 * cannot offer a placement the save would reject. A teacher who advises nothing
 * gets a disabled button carrying the server's own reason instead.
 */
async function LearnersAddControl({
  user,
}: {
  user: { id: string; schoolId: string; advisorySectionId: string | null };
}) {
  const advisory = await getAdvisoryPlacement(user);
  if (!advisory) return <LearnerAddMenuDisabled reason={NO_ADVISORY_MESSAGE} />;

  return (
    <LearnerAddMenu
      gradeLevelId={advisory.gradeLevelId}
      gradeType={advisory.gradeType}
      placement={{
        gradeLabel: advisory.gradeLabel,
        sectionName: advisory.sectionName,
      }}
    />
  );
}

async function LearnersBody({
  assignedGrades,
  schoolId,
  teacherId,
  isSuperAdmin,
  schoolIdParam,
  list,
}: {
  assignedGrades: { id: string; type: string }[];
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  schoolIdParam?: string;
  list: ReturnType<typeof parseLearnerListParams>;
}) {
  const assignedGradeIds = assignedGrades.map((g) => g.id);
  const activeGrade: LearnerListGradeFilter =
    list.grade !== "all" && assignedGradeIds.includes(list.grade)
      ? list.grade
      : "all";

  const where = learnerListWhere({
    assignedGradeIds,
    teacherId,
    isSuperAdmin,
    list: { ...list, grade: activeGrade },
  });

  // Section is no longer a facet, but it is still a column: this answers "does
  // this grade use sections at all", which is what decides whether the column
  // earns its width.
  const [sections, totalCount] = await Promise.all([
    getGradeSections({
      schoolId,
      gradeLevelIds: activeGrade === "all" ? assignedGradeIds : [activeGrade],
    }),
    prisma.learner.count({ where }),
  ]);

  const pages = totalPages(totalCount, list.pageSize);
  const page = Math.min(list.page, pages);
  const skip = (page - 1) * list.pageSize;

  const learners = await prisma.learner.findMany({
    relationLoadStrategy: "join",
    where,
    select: {
      id: true,
      fullName: true,
      age: true,
      gender: true,
      isAralLearner: true,
      archivedAt: true,
      englishReadingProfile: true,
      filipinoReadingProfile: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { id: true, name: true } },
      // Presence only — this drives the ARAL Profile column.
      aralProfile: { select: { id: true } },
    },
    orderBy: { fullName: "asc" },
    skip,
    take: list.take,
  });

  const rows: LearnerListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    age: l.age,
    gender: l.gender,
    isAralLearner: l.isAralLearner,
    hasAralProfile: l.aralProfile !== null,
    archivedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
    englishReadingProfile: l.englishReadingProfile,
    filipinoReadingProfile: l.filipinoReadingProfile,
    section: l.section,
    gradeLevelId: l.gradeLevelId,
    gradeType: l.gradeLevel.type,
  }));

  const gradeOptions = assignedGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
  }));

  return (
    <LearnerListClient
      basePath="/teacher/learners"
      grade={activeGrade}
      gender={list.gender}
      aralStatus={list.aralStatus}
      grades={gradeOptions}
      sections={sections.map((s) => ({ id: s.id, name: s.name }))}
      schoolId={schoolIdParam}
      isSuperAdmin={isSuperAdmin}
      learners={rows}
      page={page}
      pageSize={list.pageSize}
      totalCount={totalCount}
      q={list.q}
    />
  );
}

export default async function TeacherLearnersPage({
  searchParams,
}: TeacherLearnersPageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);
  const schoolId =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;

  if (!schoolId) redirect("/login");

  // The teacher layout already awaited this exact call for this request, and it is
  // React-`cache()`d on (schoolId, teacherId, isSuperAdmin) — so reading the
  // designation here costs no extra query. `grades` is the half this page used
  // before; the designation rides along.
  const { grades: shellGrades, designation } = await getTeacherShellContext({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  // A Non-DepEd ARAL Volunteer advises no section, so this roster is not theirs.
  // The sidebar shows the row inert with a "DepEd only" pill; this is the gate
  // behind it, because a disabled row is not access control — the row can be
  // bypassed by typing the URL, and the dashboard cards still link here. The copy
  // answers the same question the pill raises, at the length a page allows.
  // The Super Admin carve-out and the fail-open behaviour both live in
  // `deniesAdvisoryRoster`, which is unit-tested — see its doc for why the
  // impersonation branch must not be folded away.
  if (deniesAdvisoryRoster({ isSuperAdmin, designation })) {
    return (
      <AppShell
        title="Learners"
        role={user.role}
        userName={user.fullName || `${user.firstName} ${user.lastName}`}
      >
        <EmptyState
          icon={Sparkles}
          title="Open to DepEd advisers only"
          description="The advisory roster belongs to the DepEd teacher who advises a section. As a Non-DepEd ARAL Volunteer you don't advise one, so there's nothing to manage here. Your ARAL learners are in the ARAL Program."
          actionHref="/teacher/aral"
          actionLabel="Go to ARAL Program"
        />
      </AppShell>
    );
  }

  // Redirects may land with ?grade= for a grade not in shell cache yet —
  // still include it when the teacher (or SA) can access it.
  let assignedGrades = shellGrades.map((g) => ({ id: g.id, type: g.type }));
  if (
    list.grade !== "all" &&
    !assignedGrades.some((g) => g.id === list.grade)
  ) {
    const extra = await prisma.gradeLevel.findFirst({
      where: isSuperAdmin
        ? { id: list.grade, schoolId, deletedAt: null }
        : {
            id: list.grade,
            schoolId,
            deletedAt: null,
            ...teacherGradeScope(user.id),
          },
      select: { id: true, type: true },
    });
    if (extra) assignedGrades = [extra, ...assignedGrades];
  }

  const assignedGradeIds = assignedGrades.map((g) => g.id);

  return (
    <AppShell
      title="Learners"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      hideTitle
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:mb-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Learners
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage and view all learners in your advisory.
            {isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}
          </p>
        </div>
        {!isSuperAdmin ? (
          <Suspense fallback={<Skeleton className="h-9 w-44" />}>
            <LearnersAddControl
              user={{
                id: user.id,
                schoolId,
                advisorySectionId: user.advisorySectionId,
              }}
            />
          </Suspense>
        ) : null}
      </div>

      {assignedGrades.length === 0 ? (
        <EmptyState
          title="No grades assigned"
          description="Ask your school head to assign you to a grade level."
        />
      ) : (
        <>
          <Suspense fallback={<LearnerStatCardsSkeleton />}>
            <LearnerStatCards
              assignedGradeIds={assignedGradeIds}
              teacherId={user.id}
              isSuperAdmin={isSuperAdmin}
            />
          </Suspense>

          <div className="mt-4">
            <Suspense fallback={<LearnerTableSkeleton />}>
              <LearnersBody
                assignedGrades={assignedGrades}
                schoolId={schoolId}
                teacherId={user.id}
                isSuperAdmin={isSuperAdmin}
                schoolIdParam={sp.schoolId}
                list={list}
              />
            </Suspense>
          </div>
        </>
      )}
    </AppShell>
  );
}
