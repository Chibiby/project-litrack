import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  getAdminActivitySeries,
  getAdminRecentSchools,
  getAdminIpAndAdvisoryMetrics,
} from "@/lib/dashboard/aggregates";
import { collapseKindsToOthers, topSchoolsWithIp } from "@/lib/dashboard/ip-metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
  DashboardPieChart,
} from "@/components/dashboard/lazy-charts";
import {
  School,
  Users,
  ChevronRight,
  ScrollText,
  GraduationCap,
} from "lucide-react";

/**
 * The Super Admin dashboard sections that fetch on their own and stream
 * behind their own `<Suspense>`: IP metrics, the two trend charts and the
 * recent-schools drill-down. The hero, stat row, attention rail and quick
 * actions live in `src/components/dashboard/admin/dashboard-body.tsx`.
 */

export async function AdminChartsSection() {
  let activity: Awaited<ReturnType<typeof getAdminActivitySeries>> | null =
    null;
  try {
    activity = await getAdminActivitySeries();
  } catch (err) {
    console.error("[AdminChartsSection] failed to load:", err);
  }

  const hasActivity = (activity?.activityByDay ?? []).some((d) => d.value > 0);
  const hasSchools = (activity?.schoolsTotal ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="School status"
        description="Active vs inactive schools"
        className="min-w-0 rounded-2xl"
      >
        {!hasSchools ? (
          <EmptyState
            title="No data yet"
            description="Create a school to see status breakdown."
            actionHref="/admin/schools/new"
            actionLabel="New school"
            icon={School}
          />
        ) : (
          <DashboardBarChart data={activity!.schoolStatus} />
        )}
      </ChartCard>
      <ChartCard
        title="Platform activity (7 days)"
        description="Audit events per day"
        className="min-w-0 rounded-2xl"
      >
        {!hasActivity ? (
          <EmptyState
            title="No data yet"
            description="Activity trends appear once audited actions are recorded."
            actionHref="/admin/audit"
            actionLabel="View audit"
            icon={ScrollText}
          />
        ) : (
          <DashboardLineChart
            data={activity!.activityByDay}
            color="hsl(var(--secondary))"
          />
        )}
      </ChartCard>
    </div>
  );
}

export async function AdminIpAdvisorySection() {
  let data: Awaited<ReturnType<typeof getAdminIpAndAdvisoryMetrics>> | null =
    null;
  try {
    data = await getAdminIpAndAdvisoryMetrics();
  } catch (err) {
    console.error("[AdminIpAdvisorySection] failed to load:", err);
  }

  const schools = topSchoolsWithIp(data?.schools ?? [], 5);
  const kinds = collapseKindsToOthers(data?.ipKinds ?? [], 5);

  const viewAll = (
    <Button asChild size="sm" variant="outline" className="lg:h-9">
      <PrefetchLink href="/admin/ip-learners">View all</PrefetchLink>
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          title="Learners per teacher"
          value={data?.national.learnersPerTeacher ?? "—"}
          hint={`${data?.national.totalLearners ?? 0} enrolled · ${data?.national.activeTeachers ?? 0} active teachers`}
          icon={Users}
          tone="primary"
          decor="people"
          inlineOnPhone
          denseOnPhone
        />
        <StatCard
          title="IP learners"
          value={data?.national.ipLearners ?? 0}
          hint={`${data?.national.ipPercent ?? "—"} of enrolled learners`}
          icon={GraduationCap}
          tone="amber"
          decor="bars"
          inlineOnPhone
          denseOnPhone
          href="/admin/ip-learners"
        />
      </div>

      {/* One-up at xl, where the attention rail narrows this column; two-up
          again at 2xl once it is wide enough for a table beside a donut. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <ChartCard
          title="Schools with IP learners"
          description="Top 5 by count"
          action={viewAll}
          className="min-w-0 rounded-2xl"
          contentClassName="p-0 sm:p-2"
        >
          {schools.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No IP learners yet"
                description="Appears once enrolled learners have an IP ethnicity recorded."
                icon={School}
              />
            </div>
          ) : (
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap max-sm:[&_td]:px-3 max-sm:[&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead className="text-right">Per teacher</TableHead>
                  <TableHead className="text-right">IP</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">IP %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((s) => (
                  <TableRow key={s.schoolId}>
                    <TableCell className="max-w-[14rem] truncate font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.learnersPerTeacher}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.ipLearners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.totalLearners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.ipPercent}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
        <ChartCard
          title="IP learners by group"
          description="A learner with two IP groups counts in both"
          action={viewAll}
          className="min-w-0 rounded-2xl"
        >
          {kinds.length === 0 ? (
            <EmptyState
              title="No data yet"
              description="Appears once enrolled learners have an IP ethnicity recorded."
              icon={GraduationCap}
            />
          ) : (
            <DashboardPieChart data={kinds} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

export async function AdminRecentSchoolsSection() {
  let recentSchools: Awaited<ReturnType<typeof getAdminRecentSchools>> = [];
  try {
    recentSchools = await getAdminRecentSchools();
  } catch (err) {
    console.error("[AdminRecentSchoolsSection] failed to load:", err);
  }

  return (
    <Surface as="section" className="rounded-2xl">
      <SurfaceHeader className="flex-col gap-1 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <School className="size-5 text-primary" aria-hidden />
            Open a school as its School Head
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The newest schools. Your first view of each is audited, once per 8 hours.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="lg:h-9">
          <PrefetchLink href="/admin/schools">All schools</PrefetchLink>
        </Button>
      </SurfaceHeader>
      <SurfaceBody className="p-3 sm:p-4">
        {recentSchools.length === 0 ? (
          <EmptyState
            title="No data yet"
            description="Create a school to enable drill-down."
            actionHref="/admin/schools/new"
            actionLabel="New school"
            icon={School}
            className="border-0 bg-transparent py-6"
          />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {recentSchools.map((school) => (
              <li key={school.id} className="min-w-0">
                <PrefetchLink
                  href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground lg:truncate">
                      {school.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {school.schoolIdCode}
                      {!school.isActive ? " · Inactive" : ""}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </PrefetchLink>
              </li>
            ))}
          </ul>
        )}
      </SurfaceBody>
    </Surface>
  );
}
