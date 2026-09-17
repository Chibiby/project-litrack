import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  getAdminMetricCounts,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
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
  ExternalLink,
  Sparkles,
  ScrollText,
  UserCog,
  AlertTriangle,
  GraduationCap,
} from "lucide-react";

export async function AdminMetricsSection() {
  let metrics: Awaited<ReturnType<typeof getAdminMetricCounts>> | null = null;
  try {
    metrics = await getAdminMetricCounts();
  } catch (err) {
    console.error("[AdminMetricsSection] failed to load:", err);
  }

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 md:max-lg:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Schools"
          value={metrics?.schoolsTotal ?? 0}
          hint={`${metrics?.schoolsActive ?? 0} active · ${metrics?.schoolsInactive ?? 0} inactive`}
          icon={School}
          tone="primary"
          href="/admin/schools"
        />
        <MetricCard
          title="School Heads"
          value={metrics?.schoolHeadCount ?? 0}
          icon={UserCog}
          href="/admin/schools"
        />
        <MetricCard
          title="Teachers"
          value={metrics?.teacherCount ?? 0}
          icon={Users}
          href="/admin/schools"
        />
        <MetricCard
          title="Learners"
          value={metrics?.learnerCount ?? 0}
          icon={GraduationCap}
          tone="amber"
        />
        <MetricCard
          title="ARAL learners"
          value={metrics?.aralCount ?? 0}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="Alerts"
          value={metrics?.pendingTeacherApprovals ?? 0}
          hint="Teachers awaiting approval"
          icon={AlertTriangle}
          href="/admin/audit"
        />
      </div>

      {(metrics?.schoolsInactive ?? 0) > 0 ||
      (metrics?.pendingTeacherApprovals ?? 0) > 0 ? (
        <Card className="mb-6 border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />
              Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-amber-950 dark:text-amber-100">
            {(metrics?.schoolsInactive ?? 0) > 0 ? (
              <p>{metrics!.schoolsInactive} inactive school(s).</p>
            ) : null}
            {(metrics?.pendingTeacherApprovals ?? 0) > 0 ? (
              <p>
                {metrics!.pendingTeacherApprovals} teacher registration(s)
                awaiting School Head approval.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

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
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <ChartCard title="School status" description="Active vs inactive schools">
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

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Learners per teacher"
          value={data?.national.learnersPerTeacher ?? "—"}
          hint={`${data?.national.totalLearners ?? 0} enrolled learners · across ${data?.national.activeTeachers ?? 0} active teachers`}
          icon={Users}
          tone="primary"
        />
        <MetricCard
          title="IP learners"
          value={data?.national.ipLearners ?? 0}
          hint={`${data?.national.ipPercent ?? "—"} of enrolled learners`}
          icon={GraduationCap}
          tone="amber"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Schools"
          description="Top 5 schools with IP learners, by count"
          action={
            <Button asChild size="sm" variant="outline">
              <PrefetchLink href="/admin/ip-learners">View all</PrefetchLink>
            </Button>
          }
        >
          {schools.length === 0 ? (
            <EmptyState
              title="No IP learners yet"
              description="Appears once enrolled learners have an IP ethnicity recorded."
              icon={School}
            />
          ) : (
            <Table>
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
                    <TableCell className="font-medium">{s.name}</TableCell>
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
          description="All schools; a learner with two IP groups counts in both"
          action={
            <Button asChild size="sm" variant="outline">
              <PrefetchLink href="/admin/ip-learners">View all</PrefetchLink>
            </Button>
          }
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
    </>
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
    <Card className="mb-6 border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <School className="h-5 w-5 text-primary" />
          School drill-down
        </CardTitle>
        <CardDescription>
          Open a school with <code className="text-xs">?schoolId=</code> — first
          view per school is audited (once per 8h).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {recentSchools.map((school) => (
            <Button
              key={school.id}
              variant="outline"
              size="sm"
              asChild
              className="bg-card"
            >
              <PrefetchLink
                href={`${SCHOOL_HEAD_ROUTES.dashboard}?schoolId=${school.id}`}
              >
                {school.name}
                {!school.isActive ? " (inactive)" : ""}
                <ExternalLink className="ml-1 h-3 w-3" />
              </PrefetchLink>
            </Button>
          ))}
          {recentSchools.length === 0 ? (
            <EmptyState
              title="No data yet"
              description="Create a school to enable drill-down."
              actionHref="/admin/schools/new"
              actionLabel="New school"
              icon={School}
              className="w-full border-0 bg-transparent py-6"
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
