import { Suspense } from "react";
import { BookOpen, CalendarCheck, GraduationCap, School, Sparkles, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAdminIpAndAdvisoryMetrics } from "@/lib/dashboard/aggregates";
import { topSchoolsWithIp } from "@/lib/dashboard/ip-metrics";
import {
  getLearnersHubPage,
  getLearnersSummary,
  learnersHubTotalPages,
  listDistrictOptions,
  listGradeOptions,
  listSchoolOptions,
  listSectionOptions,
  parseLearnersHubParams,
  type LearnerHubRow,
  type LearnersHubParams,
  type LearnersHubSearchParams,
  type LearnersSummary,
} from "@/lib/admin/management";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricsGridSkeleton, TableSectionSkeleton, ListCardSkeleton } from "@/components/loading";
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
import { listKey } from "@/lib/nav/list-params";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

export const dynamic = "force-dynamic";

/** Params that change the directory rows; `q` left out so typing keeps focus (see `listKey`). */
const LEARNERS_LIST_KEYS = ["page", "district", "schoolId", "grade", "section", "ip", "aral"] as const;
/** The figures follow the district / school scope only. */
const LEARNERS_SUMMARY_KEYS = ["district", "schoolId"] as const;

const n = (value: number) => value.toLocaleString();

async function summaryScope(params: LearnersHubParams): Promise<string> {
  const schools = params.schoolId ? await listSchoolOptions({ district: params.district }) : [];
  return scopeLabel({ district: params.district, schoolId: params.schoolId, schools });
}

async function LearnersCards({ params }: { params: LearnersHubParams }) {
  let summary: LearnersSummary;
  let scope: string;
  try {
    [summary, scope] = await Promise.all([
      getLearnersSummary({ district: params.district, schoolId: params.schoolId }),
      summaryScope(params),
    ]);
  } catch (err) {
    console.error("[AdminLearnersPage] failed to load summary:", err);
    return <SummaryUnavailable what="learner" />;
  }
  const card = { inlineOnPhone: true, denseOnPhone: true } as const;
  return (
    <SummaryGrid scope={scope} label="Learner overview">
      {/* Learners, IP and ARAL use the dashboard's figures and words. */}
      <StatCard
        title="Learners"
        value={n(summary.totalLearners)}
        hint={params.district || params.schoolId ? `In ${scope}` : "Across every school"}
        icon={GraduationCap}
        tone="amber"
        {...card}
      />
      <StatCard title="Enrolled this school year" value={n(summary.enrolledThisYear)} hint="Active enrollment in the current year" icon={CalendarCheck} tone="primary" {...card} />
      <StatCard title="Male" value={n(summary.bySex.male)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard title="Female" value={n(summary.bySex.female)} hint="Of all learners" icon={Users} tone="neutral" {...card} />
      <StatCard title="IP learners (enrolled)" value={n(summary.ipLearners)} hint={`${summary.ipPercent} of enrolled`} icon={School} tone="amber" {...card} />
      <StatCard title="ARAL learners" value={n(summary.aralLearners)} hint="In the ARAL program" icon={Sparkles} tone="violet" {...card} />
    </SummaryGrid>
  );
}

function share(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

async function LearnersBreakdowns({ params }: { params: LearnersHubParams }) {
  let summary: LearnersSummary;
  let scope: string;
  try {
    [summary, scope] = await Promise.all([
      getLearnersSummary({ district: params.district, schoolId: params.schoolId }),
      summaryScope(params),
    ]);
  } catch (err) {
    console.error("[AdminLearnersPage] failed to load breakdowns:", err);
    return <SummaryUnavailable what="breakdown" />;
  }
  const ipTotal = summary.ipByGroup.reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Learners by grade</h2>
          <span className="text-xs text-muted-foreground">{scope}</span>
        </SurfaceHeader>
        {summary.byGrade.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title="No learners yet"
              description="Appears once schools add learners."
              icon={BookOpen}
            />
          </SurfaceBody>
        ) : (
          <ul className="space-y-2 px-4 pb-4 pt-1" aria-label="Learners by grade">
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
                  <span className="text-xs text-muted-foreground">
                    ({share(g.count, summary.totalLearners)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface as="section" className="min-w-0 rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">IP learners by group</h2>
          <span className="text-xs text-muted-foreground">
            A learner with two IP groups counts in both
          </span>
        </SurfaceHeader>
        {summary.ipByGroup.length === 0 ? (
          <SurfaceBody>
            <EmptyState
              title="No IP learners"
              description="Appears once enrolled learners have an IP ethnicity recorded."
              icon={GraduationCap}
            />
          </SurfaceBody>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Group</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="pr-4 text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.ipByGroup.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="pl-4 font-medium">{g.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(g.count)}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{share(g.count, ipTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Surface>
    </div>
  );
}

async function SchoolsWithIp() {
  let data: Awaited<ReturnType<typeof getAdminIpAndAdvisoryMetrics>> | null = null;
  try {
    data = await getAdminIpAndAdvisoryMetrics();
  } catch (err) {
    console.error("[AdminLearnersPage] failed to load schools with IP learners:", err);
  }
  const schools = topSchoolsWithIp(data?.schools ?? [], Number.POSITIVE_INFINITY);

  return (
    <Surface as="section" className="min-w-0 rounded-2xl">
      <SurfaceHeader>
        <h2 className="text-base font-semibold">Schools with IP learners</h2>
        <span className="text-xs text-muted-foreground">Whole division · ignores the filters above</span>
      </SurfaceHeader>
      {!data ? (
        <SurfaceBody>
          <p className="text-sm text-muted-foreground">
            This table could not be loaded right now. Reload the page to try again.
          </p>
        </SurfaceBody>
      ) : schools.length === 0 ? (
        <SurfaceBody>
          <EmptyState
            title="No IP learners yet"
            description="Appears once enrolled learners have an IP ethnicity recorded."
            icon={School}
          />
        </SurfaceBody>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">School</TableHead>
                  <TableHead className="text-right">Per teacher</TableHead>
                  <TableHead className="text-right">IP</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-4 text-right">IP %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((s) => (
                  <TableRow key={s.schoolId}>
                    <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.learnersPerTeacher}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.ipLearners}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.totalLearners}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{s.ipPercent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y divide-border/60 lg:hidden" aria-label="Schools with IP learners">
            {schools.map((s) => (
              <li key={s.schoolId} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{s.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {s.totalLearners} enrolled · {s.learnersPerTeacher} per teacher
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-foreground">{s.ipLearners}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{s.ipPercent}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Surface>
  );
}

async function directoryFilters(params: LearnersHubParams): Promise<ListFilterField[]> {
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

async function LearnersDirectoryBody({ params }: { params: LearnersHubParams }) {
  let rows: LearnerHubRow[] = [];
  let totalCount = 0;
  let filters: ListFilterField[] = [];
  let dbAvailable = true;
  try {
    const [page, loadedFilters] = await Promise.all([getLearnersHubPage(params), directoryFilters(params)]);
    rows = page.rows;
    totalCount = page.totalCount;
    filters = loadedFilters;
  } catch (err) {
    console.error("[AdminLearnersPage] failed to load directory:", err);
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
        basePath={ADMIN_ROUTES.learners}
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
 * Division-wide learner hub: headline figures, the searchable directory, the
 * grade and IP-group breakdowns, and the schools-with-IP table. The figures
 * and breakdowns follow the district / school filters; the directory follows
 * every filter.
 */
export default async function AdminLearnersPage({
  searchParams,
}: {
  searchParams: Promise<LearnersHubSearchParams>;
}) {
  const user = await requireUser("SUPER_ADMIN");
  const raw = await searchParams;
  const params = parseLearnersHubParams(raw);
  const summaryKey = listKey(raw, LEARNERS_SUMMARY_KEYS);

  return (
    <AdminPage
      title="Learners"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Management"
          eyebrowIcon={GraduationCap}
          title="Learners"
          subtitle="Every learner in the division. Find a learner, or see how they break down by grade, IP group and ARAL."
        />
      }
    >
      <Suspense key={`cards-${summaryKey}`} fallback={<MetricsGridSkeleton className="mb-0" count={6} />}>
        <LearnersCards params={params} />
      </Suspense>

      <Suspense
        key={listKey(raw, LEARNERS_LIST_KEYS)}
        fallback={<TableSectionSkeleton rows={10} columns={6} />}
      >
        <LearnersDirectoryBody params={params} />
      </Suspense>

      <Suspense key={`breakdowns-${summaryKey}`} fallback={<ListCardSkeleton />}>
        <LearnersBreakdowns params={params} />
      </Suspense>

      <Suspense fallback={<TableSectionSkeleton rows={6} columns={5} />}>
        <SchoolsWithIp />
      </Suspense>
    </AdminPage>
  );
}
