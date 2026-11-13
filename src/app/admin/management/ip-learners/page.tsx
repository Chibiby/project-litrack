import { Suspense } from "react";
import { Feather, GraduationCap, MapPinned, Percent, School, Sparkles, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getIpLearnersOverview } from "@/lib/admin/ip-learners";
import {
  getLearnersHubPage,
  learnersHubTotalPages,
  listDistrictOptions,
  listGradeOptions,
  listSchoolOptions,
  listSectionOptions,
  parseLearnersHubParams,
  type LearnerHubRow,
  type LearnersHubParams,
  type LearnersHubSearchParams,
} from "@/lib/admin/management";
import type { IpOverview } from "@/lib/ip/overview";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { ChartCard } from "@/components/dashboard/chart-card";
import { DashboardPieChart } from "@/components/dashboard/lazy-charts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricsGridSkeleton, TableSectionSkeleton, ChartSectionSkeleton } from "@/components/loading";
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
import { IpSchoolsTable } from "@/components/admin/management/ip-schools-table";
import { listKey } from "@/lib/nav/list-params";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

export const dynamic = "force-dynamic";

/** Params that change the list rows; `q` left out so typing keeps focus (see `listKey`). */
const LIST_KEYS = ["page", "district", "schoolId", "grade", "section", "aral"] as const;
/** The figures follow the district / school scope only. */
const SUMMARY_KEYS = ["district", "schoolId"] as const;

const n = (value: number) => value.toLocaleString();
const EMPTY_DESCRIPTION = "Appears once enrolled learners have an IP ethnicity recorded.";

type Loaded = { overview: IpOverview; scope: string } | null;

async function loadOverview(params: LearnersHubParams): Promise<Loaded> {
  try {
    const [overview, schools] = await Promise.all([
      getIpLearnersOverview({ district: params.district, schoolId: params.schoolId }),
      params.schoolId ? listSchoolOptions({ district: params.district }) : Promise.resolve([]),
    ]);
    return {
      overview,
      scope: scopeLabel({ district: params.district, schoolId: params.schoolId, schools }),
    };
  } catch (err) {
    console.error("[AdminIpLearnersPage] failed to load overview:", err);
    return null;
  }
}

function share(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

async function IpCards({ params }: { params: LearnersHubParams }) {
  const loaded = await loadOverview(params);
  if (!loaded) return <SummaryUnavailable what="IP" />;
  const { overview: o, scope } = loaded;
  const card = { denseOnPhone: true } as const;
  return (
    <SummaryGrid scope={scope} label="IP learner overview">
      <StatCard
        title="IP learners"
        value={n(o.ipLearners)}
        hint="Enrolled this year"
        icon={Feather}
        tone="amber"
        {...card}
      />
      <StatCard
        title="Share of enrolled"
        value={o.ipPercent}
        hint={`Of ${n(o.enrolled)} enrolled`}
        icon={Percent}
        tone="primary"
        {...card}
      />
      <StatCard
        title="IP groups"
        value={n(o.groups.length)}
        hint={o.groups[0] ? `Largest: ${o.groups[0].name}` : "None recorded yet"}
        icon={Users}
        tone="emerald"
        {...card}
      />
      <StatCard
        title="Schools with IP"
        value={n(o.schoolsWithIp)}
        hint={`Of ${n(o.schoolsInScope)} schools`}
        icon={School}
        tone="primary"
        {...card}
      />
      <StatCard
        title="IP learners in ARAL"
        value={n(o.inAral)}
        hint={`${share(o.inAral, o.ipLearners)} of IP learners`}
        icon={Sparkles}
        tone="violet"
        {...card}
      />
      <StatCard
        title="Female IP learners"
        value={share(o.bySex.female, o.ipLearners)}
        hint={`${n(o.bySex.female)} of ${n(o.ipLearners)}`}
        icon={GraduationCap}
        tone="neutral"
        {...card}
      />
    </SummaryGrid>
  );
}

async function IpBreakdowns({ params }: { params: LearnersHubParams }) {
  const loaded = await loadOverview(params);
  if (!loaded) return null;
  const { overview: o, scope } = loaded;
  const maxGrade = Math.max(1, ...o.byGrade.map((g) => g.count));

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard
        title="IP learners by group"
        description="A learner with two IP groups counts in both"
        className="min-w-0 rounded-lg"
        contentClassName="p-0"
      >
        {o.groups.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No IP learners" description={EMPTY_DESCRIPTION} icon={Feather} />
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 items-center gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <DashboardPieChart
              data={o.groups.map((g) => ({ name: g.name, value: g.count }))}
              height={260}
            />
            <ul className="divide-y divide-border/60 text-sm" aria-label="IP learners by group">
              {o.groups.map((g) => (
                <li key={g.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-medium" title={g.name}>
                    {g.name}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                    {n(g.count)}{" "}
                    <span className="inline-block w-14 text-xs text-muted-foreground">{g.share}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>

      <Surface as="section" className="min-w-0 rounded-lg">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">IP learners by grade</h2>
          <span className="text-xs text-muted-foreground">{scope}</span>
        </SurfaceHeader>
        {o.byGrade.length === 0 ? (
          <SurfaceBody>
            <EmptyState title="No IP learners" description={EMPTY_DESCRIPTION} icon={GraduationCap} />
          </SurfaceBody>
        ) : (
          <ul className="space-y-2.5 px-4 pb-4 pt-1" aria-label="IP learners by grade">
            {o.byGrade.map((g) => (
              <li key={g.grade} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="font-medium">{g.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-warning-500/80"
                    style={{ width: `${(g.count / maxGrade) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {n(g.count)}{" "}
                  <span className="text-xs text-muted-foreground">({share(g.count, o.ipLearners)})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

async function IpPlaces({ params }: { params: LearnersHubParams }) {
  const loaded = await loadOverview(params);
  if (!loaded) return null;
  const { overview: o } = loaded;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Surface as="section" className="min-w-0 rounded-lg">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">IP learners by district</h2>
          <span className="text-xs text-muted-foreground">Share of each district&apos;s enrolled learners</span>
        </SurfaceHeader>
        {o.districts.length === 0 ? (
          <SurfaceBody>
            <EmptyState title="No IP learners" description={EMPTY_DESCRIPTION} icon={MapPinned} />
          </SurfaceBody>
        ) : (
          <ResponsiveTable
            table={
              // 23 districts today: about ten rows show, the header stays pinned.
              <Table stickyHeader containerClassName="max-h-[30rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">District</TableHead>
                    <TableHead numeric>Schools</TableHead>
                    <TableHead numeric>IP</TableHead>
                    <TableHead numeric>Enrolled</TableHead>
                    <TableHead numeric className="pr-4">IP %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.districts.map((d) => (
                    <TableRow key={d.district}>
                      <TableCell className="pl-4 font-medium">{d.district}</TableCell>
                      <TableCell numeric>{n(d.schoolsWithIp)}</TableCell>
                      <TableCell numeric>{n(d.ipLearners)}</TableCell>
                      <TableCell numeric>{n(d.enrolled)}</TableCell>
                      <TableCell numeric className="pr-4">{d.ipPercent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            stacked={
              <StackedList aria-label="IP learners by district">
                {o.districts.map((d) => (
                  <StackedRow
                    key={d.district}
                    title={d.district}
                    value={
                      <>
                        {n(d.ipLearners)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">IP</span>
                      </>
                    }
                    meta={
                      <span className="tabular-nums">
                        {d.ipPercent} of {n(d.enrolled)} · {n(d.schoolsWithIp)} schools
                      </span>
                    }
                  />
                ))}
              </StackedList>
            }
          />
        )}
      </Surface>

      <Surface as="section" className="min-w-0 rounded-lg">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Schools with IP learners</h2>
          <span className="text-xs text-muted-foreground">Most IP learners first</span>
        </SurfaceHeader>
        {o.schools.length === 0 ? (
          <SurfaceBody>
            <EmptyState title="No IP learners yet" description={EMPTY_DESCRIPTION} icon={School} />
          </SurfaceBody>
        ) : (
          <IpSchoolsTable rows={o.schools} />
        )}
      </Surface>
    </div>
  );
}

async function listFilters(params: LearnersHubParams): Promise<ListFilterField[]> {
  const [districts, schools, sections] = await Promise.all([
    listDistrictOptions(),
    listSchoolOptions({ district: params.district }),
    listSectionOptions({ schoolId: params.schoolId, grade: params.grade }),
  ]);
  return [
    districtField(districts, params.district, ["schoolId", "section"]),
    schoolField(schools, params.schoolId, ["section"]),
    gradeField(listGradeOptions(), params.grade, ["section"]),
    sectionField(sections, params.section, { schoolId: params.schoolId, grade: params.grade }),
    yesNoField("aral", "ARAL", params.aral, { all: "ARAL and non-ARAL", yes: "ARAL learners only", no: "Not in ARAL" }),
  ];
}

async function IpLearnerList({ params }: { params: LearnersHubParams }) {
  let rows: LearnerHubRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, loadedFilters] = await Promise.all([getLearnersHubPage(params), listFilters(params)]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
  } catch (err) {
    console.error("[AdminIpLearnersPage] failed to load list:", err);
    dbAvailable = false;
  }

  return (
    <>
      {!dbAvailable ? (
        <p className="mb-4 text-sm text-destructive">
          Could not load IP learners right now. The database may be unavailable.
        </p>
      ) : null}
      <LearnersDirectory
        rows={rows}
        filters={filters}
        basePath={ADMIN_ROUTES.ipLearners}
        rowHrefBase={ADMIN_ROUTES.learners}
        heading="IP learner list"
        headingNote="Every IP learner on record, including those not enrolled this year. The cards above count enrolled learners only."
        emptyDescription="IP learners appear here once a learner has an IP ethnicity recorded."
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
 * Management → IP Learners: every Indigenous Peoples figure in one place —
 * headline cards, the group and grade breakdowns, districts and schools, and
 * the list of IP learners. The figures follow the district / school filters;
 * the list follows every filter and is always IP learners only.
 */
export default async function AdminIpLearnersPage({
  searchParams,
}: {
  searchParams: Promise<LearnersHubSearchParams>;
}) {
  const user = await requireUser("SUPER_ADMIN");
  const raw = await searchParams;
  // The list is IP learners only, whatever `?ip=` says.
  const params: LearnersHubParams = { ...parseLearnersHubParams(raw), ip: true };
  const summaryKey = listKey(raw, SUMMARY_KEYS);

  return (
    <AdminPage
      title="IP Learners"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={Feather}
          title="IP Learners"
          subtitle="Indigenous Peoples learners across the division: how many, which groups, where they study, and who they are."
        />
      }
    >
      <Suspense key={`cards-${summaryKey}`} fallback={<MetricsGridSkeleton className="mb-0" count={6} />}>
        <IpCards params={params} />
      </Suspense>

      <Suspense key={`breakdowns-${summaryKey}`} fallback={<ChartSectionSkeleton columns={2} />}>
        <IpBreakdowns params={params} />
      </Suspense>

      <Suspense key={`places-${summaryKey}`} fallback={<TableSectionSkeleton rows={6} columns={5} />}>
        <IpPlaces params={params} />
      </Suspense>

      <Suspense key={listKey(raw, LIST_KEYS)} fallback={<TableSectionSkeleton rows={10} columns={6} />}>
        <IpLearnerList params={params} />
      </Suspense>
    </AdminPage>
  );
}
