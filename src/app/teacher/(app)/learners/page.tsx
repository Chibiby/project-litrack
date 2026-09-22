import { Suspense, cache } from "react";
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
  advisoryRosterDenial,
  teacherGradeScope,
  teacherLearnerScope,
} from "@/lib/teachers/scope";
import {
  getAdvisoryPlacements,
  NO_ADVISORY_MESSAGE,
} from "@/lib/teachers/advisory";
import {
  DECLARED_FLOATING_CARD,
  FLOATING_TEACHER_CARD,
} from "@/lib/teachers/floating-copy";
import {
  aralStatusWhere,
  sectionIdWhere,
  genderWhere,
  gradeLevelIdWhere,
  learnerListOrderBy,
  nameSearchWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  totalPages,
  LEARNER_LIST_DEFAULT_PAGE_SIZE,
  type LearnerListGradeFilter,
} from "@/lib/learners/pagination";
import { formatListingNameFromRecord } from "@/lib/names";
import { listKey } from "@/lib/nav/list-params";
import { Sparkles } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { LEARNER_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { AdvisoryHeroControl } from "@/components/learners/advisory-hero-control";
import type {
  AdvisoryOption,
  RosterUrlState,
} from "@/components/learners/learner-list-toolbar";

export const dynamic = "force-dynamic";

/**
 * Params that change which rows the roster shows — page, sort, search, page
 * size, the five facets, and the Active/Archived tab. Keying the rows
 * Suspense boundary on exactly this set (and nothing else, e.g. `schoolId`,
 * an admin view context that never changes row identity for a given school)
 * is what lets it re-suspend for a real row change and stay put otherwise.
 * `filter` is included even though the task brief's shorthand list didn't
 * name it: switching the Active/Archived tab swaps the entire row set just
 * as surely as a facet does, so leaving it out would freeze stale rows (or
 * show no fallback) on that switch.
 */
const LEARNER_ROSTER_LIST_KEYS = [
  "page",
  "sort",
  "q",
  "perPage",
  "grade",
  "section",
  "gender",
  "aralStatus",
  "advisory",
  "filter",
] as const;

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
    section?: string;
    advisory?: string;
  }>;
}

function learnerListWhere(opts: {
  assignedGradeIds: string[];
  teacherId: string;
  isSuperAdmin: boolean;
  list: ReturnType<typeof parseLearnerListParams>;
}): Prisma.LearnerWhereInput {
  const { assignedGradeIds, teacherId, isSuperAdmin, list } = opts;
  const stateScope: Prisma.LearnerWhereInput =
    list.filter === "archived"
      ? { OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }] }
      : { archivedAt: null, deletedAt: null };
  const accessScope: Prisma.LearnerWhereInput = isSuperAdmin
    ? {}
    : teacherLearnerScope(teacherId);
  const where: Prisma.LearnerWhereInput = {
    ...gradeLevelIdWhere(list.grade, assignedGradeIds),
    // Keep access and archive state in separate AND branches: both predicates
    // contain OR clauses, and spreading either would overwrite the other.
    // Section and advisory both narrow `sectionId`, so they are ANDed too; the
    // toolbar clears one when the other is picked.
    AND: [
      accessScope,
      stateScope,
      sectionIdWhere(list.section),
      list.advisory ? { sectionId: list.advisory } : {},
    ],
    ...genderWhere(list.gender),
    ...aralStatusWhere(list.aralStatus),
    ...nameSearchWhere(list.q),
  };

  if (list.filter !== "archived") {
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
/** One placements read per request, shared by the add control and the roster. */
const placementsFor = cache((id: string, schoolId: string) =>
  getAdvisoryPlacements({ id, schoolId })
);

/** Placements narrowed to this roster's grades, shaped for the advisory switcher. */
function advisoryOptionsFromPlacements(
  placements: Awaited<ReturnType<typeof getAdvisoryPlacements>>,
  assignedGradeIds: string[]
): AdvisoryOption[] {
  return placements
    .filter((p) => assignedGradeIds.includes(p.gradeLevelId))
    .map((p) => ({
      id: p.sectionId,
      gradeLevelId: p.gradeLevelId,
      label: `${p.gradeLabel} - ${p.sectionName}`,
    }));
}

/**
 * The advisory switcher floated in the hero's top-right corner. Its own
 * Suspense boundary, like `LearnersAddControl`, so the hero paints before the
 * placements read resolves.
 */
async function LearnersHeroAdvisory({
  basePath,
  urlState,
  teacherId,
  schoolId,
  isSuperAdmin,
  assignedGradeIds,
}: {
  basePath: string;
  urlState: RosterUrlState;
  teacherId: string;
  schoolId: string;
  isSuperAdmin: boolean;
  assignedGradeIds: string[];
}) {
  const placements = isSuperAdmin ? [] : await placementsFor(teacherId, schoolId);
  const advisories = advisoryOptionsFromPlacements(placements, assignedGradeIds);
  const advisory = advisories.find((a) => a.id === urlState.advisory) ?? null;
  return (
    <AdvisoryHeroControl
      basePath={basePath}
      state={{ ...urlState, advisory: advisory?.id ?? null }}
      advisories={advisories}
    />
  );
}

async function LearnersAddControl({
  user,
}: {
  user: { id: string; schoolId: string };
}) {
  // The Add menu targets ONE section. A teacher with several advisories picks
  // which one in the form itself, via every placement passed down here; the
  // import link (which cannot express a choice) still targets the first.
  const placements = await placementsFor(user.id, user.schoolId);
  if (placements.length === 0) {
    return <LearnerAddMenuDisabled reason={NO_ADVISORY_MESSAGE} />;
  }

  return <LearnerAddMenu placements={placements} />;
}

async function LearnersBody({
  assignedGrades,
  schoolId,
  teacherId,
  isSuperAdmin,
  schoolIdParam,
  list,
  addControl,
}: {
  addControl?: React.ReactNode;
  assignedGrades: { id: string; type: string }[];
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  schoolIdParam?: string;
  list: ReturnType<typeof parseLearnerListParams>;
}) {
  const assignedGradeIds = assignedGrades.map((g) => g.id);

  // Super Admin advises nothing; everyone else gets their advisories, kept only
  // where the grade is one this roster lists.
  const placements = isSuperAdmin ? [] : await placementsFor(teacherId, schoolId);
  const advisories = advisoryOptionsFromPlacements(placements, assignedGradeIds);
  // An advisory in the URL counts only if it is really one of theirs, and it
  // pins the grade it belongs to.
  const advisory = advisories.find((a) => a.id === list.advisory) ?? null;

  const requestedGrade = advisory ? advisory.gradeLevelId : list.grade;
  const activeGrade: LearnerListGradeFilter =
    requestedGrade !== "all" && assignedGradeIds.includes(requestedGrade)
      ? requestedGrade
      : "all";

  const where = learnerListWhere({
    assignedGradeIds,
    teacherId,
    isSuperAdmin,
    list: { ...list, grade: activeGrade, advisory: advisory?.id ?? null },
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
      firstName: true,
      middleName: true,
      lastName: true,
      fullName: true,
      age: true,
      gender: true,
      isAralLearner: true,
      archivedAt: true,
      deletedAt: true,
      englishReadingProfile: true,
      filipinoReadingProfile: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { id: true, name: true } },
    },
    orderBy: learnerListOrderBy(list.sort),
    skip,
    take: list.take,
  });

  const rows: LearnerListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    listingName: formatListingNameFromRecord(l),
    age: l.age,
    gender: l.gender,
    isAralLearner: l.isAralLearner,
    archivedAt: (l.archivedAt ?? l.deletedAt)?.toISOString() ?? null,
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
      section={list.section}
      advisory={advisory?.id ?? null}
      advisories={advisories}
      sort={list.sort}
      addControl={addControl}
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
      archivedView={list.filter === "archived"}
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
  const {
    grades: shellGrades,
    designation,
    advisoryMode,
  } = await getTeacherShellContext({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  // A Non-DepEd ARAL Volunteer advises no section, so this roster is not theirs;
  // a DepEd teacher set to FLOATING has declared they will not. The sidebar
  // shows the row inert with the matching pill; this is the gate behind it,
  // because a disabled row is not access control — the row can be bypassed by
  // typing the URL, and the dashboard cards still link here. The copy answers
  // the same question the pill raises, at the length a page allows. The Super
  // Admin carve-out and the fail-open behaviour both live in
  // `advisoryRosterDenial`, which is unit-tested — see its doc for why the
  // impersonation branch must not be folded away.
  const denial = advisoryRosterDenial({ isSuperAdmin, designation, advisoryMode });
  if (denial === "volunteer") {
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
  if (denial === "floating") {
    return (
      <AppShell
        title="Learners"
        role={user.role}
        userName={user.fullName || `${user.firstName} ${user.lastName}`}
      >
        <EmptyState {...DECLARED_FLOATING_CARD} />
      </AppShell>
    );
  }

  // §5: a floating DepEd teacher — one who advises no section. `shellGrades` is
  // the union `teacherGradeScope` resolves: grades they advise in, plus grades
  // holding a learner they tutor for ARAL. Empty therefore means there is
  // genuinely nothing this roster could list, which is exactly when a table
  // reads as broken rather than as empty.
  //
  // Keyed on that union rather than on the advisory alone, deliberately: a
  // floating teacher who DOES tutor ARAL learners still sees them here, because
  // `teacherLearnerScope` reaches them. Refusing the page on "no advisory" would
  // hide rows they are entitled to.
  if (!isSuperAdmin && shellGrades.length === 0) {
    return (
      <AppShell
        title="Learners"
        role={user.role}
        userName={user.fullName || `${user.firstName} ${user.lastName}`}
      >
        <EmptyState {...FLOATING_TEACHER_CARD} />
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
  // force-dynamic: a fresh pick per request never mismatches on hydration.
  const quote = pickQuote(Math.random, LEARNER_QUOTES);

  const heroUrlState: RosterUrlState = {
    q: list.q,
    grade: list.grade,
    section: list.section,
    advisory: list.advisory,
    gender: list.gender,
    aralStatus: list.aralStatus,
    sort: list.sort,
    perPage: list.pageSize !== LEARNER_LIST_DEFAULT_PAGE_SIZE ? list.pageSize : undefined,
    schoolId: sp.schoolId,
    archivedView: list.filter === "archived",
  };

  return (
    <AppShell
      title="Learners"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      hideTitle
    >
      <PageHero
        bannerSrc="/brand/banner-learner.webp"
        topRight={
          <Suspense
            fallback={
              <Skeleton className="h-9 w-32 rounded-xl sm:h-10 sm:w-44 lg:h-11 lg:w-56" />
            }
          >
            <LearnersHeroAdvisory
              basePath="/teacher/learners"
              urlState={heroUrlState}
              teacherId={user.id}
              schoolId={schoolId}
              isSuperAdmin={isSuperAdmin}
              assignedGradeIds={assignedGradeIds}
            />
          </Suspense>
        }
        artClassName="h-[75%] right-[calc(100%-509px)] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
        phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_52%,black_55%)]"
        headClassName="max-lg:hidden"
        contentClassName="lg:min-h-[17rem]"
      >
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white lg:text-5xl">
          Learners
        </h1>
        <p className="mt-2 max-w-[10.5rem] text-base leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[16rem] lg:max-w-md lg:text-lg lg:text-slate-800">
          Manage and view all learners in your advisories.
          {isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}
        </p>
        <blockquote className="mt-3 max-w-[10.5rem] text-sm italic leading-relaxed text-slate-600 dark:text-slate-300 sm:max-w-[16rem] lg:mt-4 lg:max-w-lg">
          &ldquo;{quote.text}&rdquo;
          <footer className="not-italic">— {quote.author}</footer>
        </blockquote>
      </PageHero>

      {assignedGrades.length === 0 ? (
        <EmptyState
          title="No grades assigned"
          description="Ask your school head to assign you to a grade level."
        />
      ) : (
        <>
          {/* The cards rise into the hero's soft lower edge, as on the dashboard. */}
          <div className="relative z-10 mt-4 lg:-mt-14">
          <Suspense fallback={<LearnerStatCardsSkeleton />}>
            <LearnerStatCards
              assignedGradeIds={assignedGradeIds}
              teacherId={user.id}
              isSuperAdmin={isSuperAdmin}
            />
          </Suspense>
          </div>

          <div className="mt-4">
            <Suspense
              key={listKey(sp, LEARNER_ROSTER_LIST_KEYS)}
              fallback={<LearnerTableSkeleton />}
            >
              <LearnersBody
                assignedGrades={assignedGrades}
                schoolId={schoolId}
                teacherId={user.id}
                isSuperAdmin={isSuperAdmin}
                schoolIdParam={sp.schoolId}
                list={list}
                addControl={
                  !isSuperAdmin ? (
                    <Suspense fallback={<Skeleton className="h-10 w-44 rounded-xl" />}>
                      <LearnersAddControl user={{ id: user.id, schoolId }} />
                    </Suspense>
                  ) : null
                }
              />
            </Suspense>
          </div>
        </>
      )}
    </AppShell>
  );
}
