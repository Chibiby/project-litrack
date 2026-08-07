import Link from "next/link";
import {
  getSchoolHeadMetricCounts,
  getSchoolHeadCharts,
  getSchoolHeadRecentActivity,
} from "@/lib/dashboard/aggregates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
} from "@/components/dashboard/lazy-charts";
import {
  GraduationCap,
  UserPlus,
  ListChecks,
  CalendarRange,
  Megaphone,
  Sparkles,
  Layers,
  ClipboardList,
} from "lucide-react";

function schoolPath(path: string, schoolId: string, isSuperAdminView: boolean) {
  return isSuperAdminView ? `${path}?schoolId=${schoolId}` : path;
}

export async function SchoolHeadMetricsSection({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  let metrics: Awaited<ReturnType<typeof getSchoolHeadMetricCounts>> | null =
    null;
  try {
    metrics = await getSchoolHeadMetricCounts(schoolId);
  } catch (err) {
    console.error("[SchoolHeadMetricsSection] failed to load:", err);
  }

  const sh = (path: string) => schoolPath(path, schoolId, isSuperAdminView);

  return (
    <>
      {!metrics?.activeYear ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active school year. New learners will not get an Enrollment until
          you set one.{" "}
          <Link
            href={sh("/school-head/school-years")}
            className="font-medium underline"
          >
            Manage school years
          </Link>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Learners"
          value={metrics?.learnerCount ?? 0}
          tone="amber"
          icon={ListChecks}
        />
        <MetricCard
          title="Teachers"
          value={metrics?.teacherCount ?? 0}
          icon={UserPlus}
          href={sh("/school-head/teachers")}
        />
        <MetricCard
          title="Grades"
          value={metrics?.gradeCount ?? 0}
          icon={GraduationCap}
          tone="primary"
          href={sh("/school-head/grade-levels")}
        />
        <MetricCard
          title="Sections"
          value={metrics?.sectionCount ?? 0}
          icon={Layers}
          href={sh("/school-head/sections")}
        />
        <MetricCard
          title="ARAL"
          value={metrics?.aralCount ?? 0}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="School year"
          value={metrics?.activeYear?.label ?? "None"}
          hint={metrics?.activeYear ? "Active" : "Set an active year"}
          icon={CalendarRange}
          href={sh("/school-head/school-years")}
        />
      </div>

      {(metrics?.setupTasks.length ?? 0) > 0 ? (
        <Card className="mb-6 border-amber-200/80 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="text-base">Incomplete setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {metrics!.setupTasks.map((t) => (
              <Button
                key={t.id}
                asChild
                size="sm"
                variant="outline"
                className="bg-white"
              >
                <Link
                  href={
                    isSuperAdminView
                      ? `${t.href}?schoolId=${schoolId}`
                      : t.href
                  }
                >
                  {t.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

export async function SchoolHeadChartsSection({
  schoolId,
}: {
  schoolId: string;
}) {
  let charts: Awaited<ReturnType<typeof getSchoolHeadCharts>> | null = null;
  try {
    charts = await getSchoolHeadCharts(schoolId);
  } catch (err) {
    console.error("[SchoolHeadChartsSection] failed to load:", err);
  }

  const hasAttendance = (charts?.attendanceTrend ?? []).some((d) => d.value > 0);
  const hasEnDist = (charts?.englishDistribution ?? []).some((d) => d.value > 0);
  const hasFilDist = (charts?.filipinoDistribution ?? []).some(
    (d) => d.value > 0
  );
  const hasReading = (charts?.readingTrend ?? []).length > 0;

  return (
    <>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Attendance (last 7 days)"
          description="Present/late marks recorded"
        >
          {!hasAttendance ? (
            <EmptyState
              title="No data yet"
              description="Attendance trends appear after teachers mark attendance."
              icon={ClipboardList}
            />
          ) : (
            <DashboardLineChart data={charts!.attendanceTrend} />
          )}
        </ChartCard>
        <ChartCard
          title="Reading progress"
          description="Monthly reading-level records"
        >
          {!hasReading ? (
            <EmptyState
              title="No data yet"
              description="Progress charts appear after monthly reading records are saved."
              icon={GraduationCap}
            />
          ) : (
            <DashboardBarChart data={charts!.readingTrend} color="#7c3aed" />
          )}
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="English reading profiles"
          description="Current Section A distribution"
        >
          {!hasEnDist ? (
            <EmptyState
              title="No data yet"
              description="Add learners to see profile distribution."
            />
          ) : (
            <DashboardBarChart
              data={charts!.englishDistribution}
              height={260}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Filipino reading profiles"
          description="Current Section A distribution"
        >
          {!hasFilDist ? (
            <EmptyState
              title="No data yet"
              description="Add learners to see profile distribution."
            />
          ) : (
            <DashboardBarChart
              data={charts!.filipinoDistribution}
              height={260}
              color="#d97706"
            />
          )}
        </ChartCard>
      </div>
    </>
  );
}

export async function SchoolHeadRecentActivitySection({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  let activity: Awaited<ReturnType<typeof getSchoolHeadRecentActivity>> | null =
    null;
  try {
    activity = await getSchoolHeadRecentActivity(schoolId);
  } catch (err) {
    console.error("[SchoolHeadRecentActivitySection] failed to load:", err);
  }

  const sh = (path: string) => schoolPath(path, schoolId, isSuperAdminView);

return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent notices</CardTitle>
        </CardHeader>
        <CardContent>
          {(activity?.announcements.length ?? 0) === 0 ? (
            <EmptyState
              title="No data yet"
              description="Post an announcement for your school."
              actionHref={sh("/school-head/announcements")}
              actionLabel="Announcements"
              icon={Megaphone}
              className="border-0 bg-transparent py-6"
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {activity!.announcements.map((a) => (
                <li
                  key={a.id}
                  className="flex justify-between gap-2 border-b border-border/60 py-2"
                >
                  <span className="font-medium">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.createdAt.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {(activity?.recentAudit.length ?? 0) === 0 ? (
            <EmptyState
              title="No data yet"
              description="Audited school actions will appear here."
              actionHref={sh("/school-head/audit")}
              actionLabel="Audit log"
              className="border-0 bg-transparent py-6"
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {activity!.recentAudit.map((a) => (
                <li
                  key={a.id}
                  className="flex justify-between gap-2 border-b border-border/60 py-2"
                >
                  <span>
                    <span className="font-medium">{a.action}</span>{" "}
                    <span className="text-muted-foreground">{a.resource}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.timestamp.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(activity?.pendingAralProfiles ?? 0) > 0 ? (
            <p className="mt-3 text-xs text-amber-800">
              {activity!.pendingAralProfiles} ARAL learner(s) still need Sections
              B–E profiling.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
