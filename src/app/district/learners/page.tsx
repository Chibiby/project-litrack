import { Suspense } from "react";
import { BarChart3, BookOpen, CalendarCheck, GraduationCap, Sparkles, Users } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import {
  getDistrictLearnersPage,
  getLearnersSummary,
  learnersHubTotalPages,
  listGradeOptions,
  listSectionOptions,
  parseLearnersHubParams,
  type LearnerHubRow,
  type LearnersHubParams,
  type LearnersHubSearchParams,
  type LearnersSummary,
} from "@/lib/admin/management";
import { districtListContext, type DistrictListContext } from "@/lib/district/management";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { listKey } from "@/lib/nav/list-params";
import { AppShell } from "@/components/app-shell";
import { PageSlide } from "@/components/ui/page-slide";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListCardSkeleton, MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { LearnersDirectory } from "@/components/admin/management/learners-directory";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  gradeField,
  schoolField,
  scopeLabel,
  sectionField,
  yesNoField,
} from "@/components/admin/management/filter-fields";
import { SummaryGrid, SummaryUnavailable } from "@/components/admin/management/summary-cards";
import { describeScope } from "@/components/district/scope-label";

export const dynamic = "force-dynamic";

const LIST_KEYS = ["page", "district", "schoolId", "grade", "section", "aral"] as const;
const SUMMARY_KEYS = ["district", "schoolId"] as const;

const n = (value: number) => value.toLocaleString();

function share(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

function scopeOf(ctx: DistrictListContext): string {
  if (ctx.district || ctx.schoolId) {
    return scopeLabel({ district: ctx.district, schoolId: ctx.schoolId, schools: ctx.schoolOptions });
  }
  return "Your schools";
}

function loadSummary(ctx: DistrictListContext): Promise<LearnersSummary> {
  return getLearnersSummary({ districts: ctx.districts, district: ctx.district, schoolId: ctx.schoolId });
}

async function LearnersCards({ ctx }: { ctx: DistrictListContext }) {
  let summary: LearnersSummary;
  try {
    summary = await loadSummary(ctx);
  } catch (err) {
    console.error("[DistrictLearnersPage] failed to load summary:", err);
    return <SummaryUnavailable what="learner" />;
  }
  const scope = scopeOf(ctx);
  const card = { denseOnPhone: true } as const;
  const largest = summary.byGrade
    .filter((g) => g.grade !== "UNASSIGNED")
    .reduce<(typeof summary.byGrade)[number] | null>((best, g) => (!best || g.count > best.count ? g : best), null);
  return (
    <SummaryGrid scope={scope} label="Learner overview">
      <StatCard title="Learners" value={n(summary.totalLearners)} hint={ctx.district || ctx.schoolId ? `In ${scope}` : "Across your schools"} icon={GraduationCap} tone="amber" {...card} />
      <StatCard title="Enrolled this school year" value={n(summary.enrolledThisYear)} hint="Active enrollment in the current year" icon={CalendarCheck} tone="primary" {...card} />
      <StatCard title="Male" value={n(summary.bySex.male)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard title="Female" value={n(summary.bySex.female)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard
        title="Largest grade"
        value={largest ? largest.label : "—"}
        hint={largest ? `${n(largest.count)} learners` : "No learners yet"}
        icon={BarChart3}
        tone="emerald"
        {...card}
      />
      <StatCard title="ARAL learners" value={n(summary.aralLearners)} hint="In the ARAL program" icon={Sparkles} tone="violet" {...card} />
    </SummaryGrid>
  );
}

async function LearnersByGrade({ ctx }: { ctx: DistrictListContext }) {
  let summary: LearnersSummary;
  try {
    summary = await loadSummary(ctx);
  } catch (err) {
    console.error("[DistrictLearnersPage] failed to load breakdowns:", err);
    return <SummaryUnavailable what="breakdown" />;
  }
  return (
    <Surface as="section" className="min-w-0 rounded-lg">
      <SurfaceHeader>
        <h2 className="text-base font-semibold">Learners by grade</h2>
        <span className="text-xs text-muted-foreground">{scopeOf(ctx)}</span>
      </SurfaceHeader>
      {summary.byGrade.length === 0 ? (
        <SurfaceBody>
          <EmptyState title="No learners yet" description="Appears once your schools add learners." icon={BookOpen} />
        </SurfaceBody>
      ) : (
        <ul
          className="grid gap-y-2.5 px-4 pb-4 pt-1 lg:grid-flow-col lg:grid-cols-2 lg:gap-x-10 lg:[grid-template-rows:repeat(var(--rows),auto)]"
          style={{ "--rows": Math.ceil(summary.byGrade.length / 2) } as React.CSSProperties}
          aria-label="Learners by grade"
        >
          {summary.byGrade.map((g) => (
            <li key={g.grade} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="font-medium">{g.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{ width: share(g.count, summary.totalLearners) }}
                />
              </span>
              <span className="text-right tabular-nums">
                {n(g.count)}{" "}
                <span className="text-xs text-muted-foreground">({share(g.count, summary.totalLearners)})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

async function directoryFilters(ctx: DistrictListContext, params: LearnersHubParams): Promise<ListFilterField[]> {
  const sections = await listSectionOptions({ schoolId: ctx.schoolId, grade: params.grade });
  return [
    ...(ctx.showDistrictFilter ? [districtField(ctx.districtOptions, ctx.district, ["schoolId", "section"])] : []),
    schoolField(ctx.schoolOptions, ctx.schoolId, ["section"]),
    gradeField(listGradeOptions(), params.grade, ["section"]),
    sectionField(sections, params.section, { schoolId: ctx.schoolId, grade: params.grade }),
    yesNoField("aral", "ARAL", params.aral, { all: "ARAL and non-ARAL", yes: "ARAL learners only", no: "Not in ARAL" }),
  ];
}

async function DirectoryBody({ ctx, params }: { ctx: DistrictListContext; params: LearnersHubParams }) {
  let rows: LearnerHubRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, loaded] = await Promise.all([
      getDistrictLearnersPage(ctx.districts, params),
      directoryFilters(ctx, params),
    ]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loaded;
  } catch (err) {
    console.error("[DistrictLearnersPage] failed to load directory:", err);
    dbAvailable = false;
  }
  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">Could not load learners right now. The database may be unavailable.</p>
      ) : null}
      <LearnersDirectory
        rows={rows}
        filters={filters}
        basePath={DISTRICT_ROUTES.learners}
        emptyDescription="Appears once your schools add learners."
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
 * Every learner in the district admin's schools: headline figures, the
 * searchable directory (read-only: no row opens an admin-only profile), and
 * the grade breakdown. Every query is fenced to the admin's districts.
 */
export default async function DistrictLearnersPage({
  searchParams,
}: {
  searchParams: Promise<LearnersHubSearchParams>;
}) {
  const { user, scope } = await requireAdminScope();
  const raw = await searchParams;
  const ctx = await districtListContext(scope, { district: raw.district, schoolId: raw.schoolId });
  // The fenced district/school replace whatever the URL held.
  const params = parseLearnersHubParams({ ...raw, district: ctx.district, schoolId: ctx.schoolId });
  const summaryKey = listKey(raw, SUMMARY_KEYS);

  return (
    <AppShell
      title="Learners"
      subtitle="Every learner in your schools"
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <PageSlide side="parent">
        <div className="mb-6">
          <SchoolHeadHero
            eyebrow="Management"
            eyebrowIcon={GraduationCap}
            title="Learners"
            subtitle="Every learner in your schools. Find a learner, or see how they break down by grade and ARAL."
            meta={describeScope(scope)}
          />
        </div>
        <div className="space-y-6">
          <Suspense key={`cards-${summaryKey}`} fallback={<MetricsGridSkeleton className="mb-0" count={6} />}>
            <LearnersCards ctx={ctx} />
          </Suspense>
          <Suspense key={listKey(raw, LIST_KEYS)} fallback={<TableSectionSkeleton rows={10} columns={6} />}>
            <DirectoryBody ctx={ctx} params={params} />
          </Suspense>
          <Suspense key={`breakdowns-${summaryKey}`} fallback={<ListCardSkeleton />}>
            <LearnersByGrade ctx={ctx} />
          </Suspense>
        </div>
      </PageSlide>
    </AppShell>
  );
}
