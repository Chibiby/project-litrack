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
import { LearnersDirectory } from "@/components/admin/management/learners-directory";
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

async function LearnersDirectoryBody({
  view,
  params,
}: {
  view: SchoolHeadView;
  params: LearnersHubParams;
}) {
  let rows: LearnerHubRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, loadedFilters] = await Promise.all([
      getSchoolLearnersPage(view.schoolId, params),
      directoryFilters(params),
    ]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
  } catch (err) {
    console.error("[SchoolHeadLearnersPage] failed to load directory:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load learners right now. The database may be unavailable.
        </p>
      ) : null}
      <LearnersDirectory
        rows={rows}
        filters={filters}
        basePath={SCHOOL_HEAD_ROUTES.learners}
        hideSchool
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
 * Read-only directory of this school's learners. The school comes only from the
 * session (or the Super Admin's resolved `?schoolId=` view), never from a filter.
 */
export default async function SchoolHeadLearnersPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const { view } = await resolveSchoolHeadView(raw.schoolId, SCHOOL_HEAD_ROUTES.learners);
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

      <Suspense
        key={listKey(raw, LEARNERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={10} columns={5} />}
      >
        <LearnersDirectoryBody view={view} params={params} />
      </Suspense>
    </SchoolHeadPage>
  );
}
