import { Suspense } from "react";
import { CalendarCheck, GraduationCap, School, Sparkles, Users } from "lucide-react";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  getSchoolLearnersPage,
  getSchoolLearnersSummary,
  learnersHubTotalPages,
  listGradeOptions,
  listSectionOptions,
  parseSchoolLearnersParams,
  type LearnerHubRow,
  type LearnersHubParams,
  type LearnersSummary,
} from "@/lib/admin/management";
import { SchoolHeadPage, schoolHeadHref } from "@/components/school-head/school-head-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  countPendingTransferRequests,
  listPendingTransferRequests,
  listTransferDestinations,
  pendingTransfersByLearner,
  type PendingTransfer,
  type PendingTransferRequestRow,
  type TransferDestination,
} from "@/lib/learners/section-transfer-queries";
import { SchoolHeadLearnersDirectory } from "@/components/school-head/learners/school-head-learners-directory";
import { TransferRequestsPanel } from "@/components/school-head/learners/transfer-requests-panel";
import type { ChangeGradeOptions } from "@/components/school-head/learners/change-grade-dialog";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import { gradeField, sectionField, yesNoField } from "@/components/admin/management/filter-fields";
import { SummaryGrid, SummaryUnavailable } from "@/components/admin/management/summary-cards";
import { listKey } from "@/lib/nav/list-params";

export const dynamic = "force-dynamic";

/** Params that change the directory rows; `q` left out so typing keeps focus (see `listKey`). */
const LEARNERS_LIST_KEYS = ["page", "grade", "section", "ip", "aral"] as const;

interface PageProps {
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    q?: string;
    grade?: string;
    section?: string;
    ip?: string;
    aral?: string;
  }>;
}

const n = (value: number) => value.toLocaleString();

async function LearnersCards({ view }: { view: SchoolHeadView }) {
  let summary: LearnersSummary;
  try {
    summary = await getSchoolLearnersSummary(view.schoolId);
  } catch (err) {
    console.error("[SchoolHeadLearnersPage] failed to load summary:", err);
    return <SummaryUnavailable what="learner" />;
  }
  const card = { inlineOnPhone: true, denseOnPhone: true } as const;
  return (
    <SummaryGrid scope={view.schoolName ?? "Your school"} label="Learner overview">
      <StatCard title="Learners" value={n(summary.totalLearners)} hint="In this school" icon={GraduationCap} tone="amber" {...card} />
      <StatCard title="Enrolled this school year" value={n(summary.enrolledThisYear)} hint="Active enrollment in the current year" icon={CalendarCheck} tone="primary" {...card} />
      <StatCard title="Male" value={n(summary.bySex.male)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard title="Female" value={n(summary.bySex.female)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard title="IP learners (enrolled)" value={n(summary.ipLearners)} hint={`${summary.ipPercent} of enrolled`} icon={School} tone="amber" {...card} />
      <StatCard title="ARAL learners" value={n(summary.aralLearners)} hint="In the ARAL program" icon={Sparkles} tone="violet" {...card} />
    </SummaryGrid>
  );
}

async function directoryFilters(params: LearnersHubParams): Promise<ListFilterField[]> {
  const sections = await listSectionOptions({ schoolId: params.schoolId, grade: params.grade });
  return [
    gradeField(listGradeOptions(), params.grade, ["section"]),
    sectionField(sections, params.section, { schoolId: params.schoolId, grade: params.grade }),
    yesNoField(
      "ip",
      "IP learner",
      params.ip,
      { all: "IP and non-IP", yes: "IP learners only", no: "Non-IP only" },
      "Filter covers every learner; the card counts enrolled learners only."
    ),
    yesNoField("aral", "ARAL", params.aral, { all: "ARAL and non-ARAL", yes: "ARAL learners only", no: "Not in ARAL" }),
  ];
}

/** Change grade's choices, as the retired transfer page loaded them. */
async function loadChangeGradeOptions(schoolId: string): Promise<ChangeGradeOptions> {
  const [grades, sections, teachers, activeYear] = await Promise.all([
    prisma.gradeLevel.findMany({
      // FLOATING is offered by the dialog as its own choice (the row is created
      // on demand), so it must not also appear as a normal grade.
      where: { schoolId, deletedAt: null, type: { not: "FLOATING" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true },
    }),
    prisma.section.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true, gradeLevelId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: { schoolId, role: "TEACHER", deletedAt: null, isActive: true },
      select: {
        id: true,
        fullName: true,
        advisorySections: {
          where: { deletedAt: null },
          select: { name: true, gradeLevelId: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.schoolYear.findFirst({ where: { schoolId, isActive: true }, select: { id: true } }),
  ]);
  return {
    grades: grades.map((g) => ({ id: g.id, label: GRADE_LEVEL_LABELS[g.type] ?? g.type })),
    sections,
    teachers: teachers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      advisories: t.advisorySections.map((s) => ({ gradeLevelId: s.gradeLevelId, sectionName: s.name })),
    })),
    hasActiveYear: activeYear !== null,
  };
}

async function TransferRequestsBody({ view, readOnly }: { view: SchoolHeadView; readOnly: boolean }) {
  let requests: PendingTransferRequestRow[] = [];
  let totalCount = 0;
  let loadFailed = false;
  try {
    [requests, totalCount] = await Promise.all([
      listPendingTransferRequests(view.schoolId),
      countPendingTransferRequests(view.schoolId),
    ]);
  } catch (err) {
    console.error("[SchoolHeadLearnersPage] failed to load transfer requests:", err);
    loadFailed = true;
  }
  if (loadFailed) {
    return (
      <p role="status" className="text-sm text-destructive">
        Couldn&apos;t load transfer requests. Refresh the page to try again.
      </p>
    );
  }
  return <TransferRequestsPanel requests={requests} readOnly={readOnly} totalCount={totalCount} />;
}

async function LearnersDirectoryBody({
  view,
  params,
  readOnly,
}: {
  view: SchoolHeadView;
  params: LearnersHubParams;
  readOnly: boolean;
}) {
  let rows: LearnerHubRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let destinations: TransferDestination[] = [];
  let pendingByLearner: Record<string, PendingTransfer> = {};
  let changeGrade: ChangeGradeOptions | null = null;
  let dbAvailable = true;
  let transfersFailed = false;
  try {
    const [page, loadedFilters, gradeOptions] = await Promise.all([
      getSchoolLearnersPage(view.schoolId, params),
      directoryFilters(params),
      readOnly ? null : loadChangeGradeOptions(view.schoolId),
    ]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
    changeGrade = gradeOptions;
  } catch (err) {
    console.error("[SchoolHeadLearnersPage] failed to load directory:", err);
    dbAvailable = false;
  }

  // A failed transfer read turns off only the transfer controls, never the directory.
  if (dbAvailable) {
    try {
      const [loadedDestinations, pending] = await Promise.all([
        readOnly ? [] : listTransferDestinations(view.schoolId, [...new Set(rows.map((r) => r.gradeLevelId))]),
        pendingTransfersByLearner(view.schoolId, rows.map((r) => r.id)),
      ]);
      destinations = loadedDestinations;
      pendingByLearner = Object.fromEntries(pending);
    } catch (err) {
      console.error("[SchoolHeadLearnersPage] failed to load transfer data:", err);
      transfersFailed = true;
    }
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load learners right now. The database may be unavailable.
        </p>
      ) : null}
      <SchoolHeadLearnersDirectory
        readOnly={readOnly}
        transfersUnavailable={transfersFailed}
        destinations={destinations}
        pendingByLearner={pendingByLearner}
        changeGrade={changeGrade}
        rows={rows}
        filters={filters}
        basePath={SCHOOL_HEAD_ROUTES.learners}
        emptyDescription="Learners appear here once you add them."
        keepParams={view.isSuperAdminView ? ["schoolId"] : undefined}
        clearHref={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.learners)}
        list={{
          page: params.page,
          pageSize: params.pageSize,
          totalPages: learnersHubTotalPages(totalCount, params.pageSize),
          totalCount,
          q: params.q,
        }}
      />
    </>
  );
}

/**
 * This school's learners, with transfers, Change grade and teachers' transfer
 * requests. The school comes only from the session (or the Super Admin's
 * resolved `?schoolId=` view), never from a filter. A Super Admin drill-down is
 * read-only: the actions need a School Head's own school.
 */
export default async function SchoolHeadLearnersPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { user, view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.learners);
  const readOnly = view.isSuperAdminView || user.role !== "SCHOOL_HEAD";
  const params = parseSchoolLearnersParams(
    { page: raw.page, q: raw.q, grade: raw.grade, section: raw.section, ip: raw.ip, aral: raw.aral },
    view.schoolId
  );

  return (
    <SchoolHeadPage
      title="Learners"
      view={view}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={GraduationCap}
          title="Learners"
          subtitle="Every learner in your school. Find a learner, or see how they break down by grade, IP group and ARAL."
        />
      }
    >
      <Suspense fallback={<MetricsGridSkeleton className="mb-0" count={6} />}>
        <LearnersCards view={view} />
      </Suspense>

      <Suspense fallback={<TableSectionSkeleton rows={3} columns={4} showToolbar={false} />}>
        <TransferRequestsBody view={view} readOnly={readOnly} />
      </Suspense>

      <Suspense
        key={listKey(raw, LEARNERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={10} columns={5} />}
      >
        <LearnersDirectoryBody view={view} params={params} readOnly={readOnly} />
      </Suspense>
    </SchoolHeadPage>
  );
}
