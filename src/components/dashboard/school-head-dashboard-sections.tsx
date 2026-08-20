import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  getSchoolHeadMetricCounts,
  getSchoolHeadCharts,
  getSchoolHeadRecentActivity,
} from "@/lib/dashboard/aggregates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
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
import { toDateKey } from "@/lib/utils";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

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
        <Callout title="No active school year">
          New learners will not get an Enrollment until you set one.{" "}
          <PrefetchLink
            href={sh(SCHOOL_HEAD_ROUTES.schoolYears)}
            prefetch={true}
            className="font-medium underline"
          >
            Manage school years
          </PrefetchLink>
        </Callout>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          href={sh(SCHOOL_HEAD_ROUTES.teachers)}
        />
        <MetricCard
          title="Grades"
          value={metrics?.gradeCount ?? 0}
          icon={GraduationCap}
          tone="primary"
          href={sh(SCHOOL_HEAD_ROUTES.schoolGradeLevels)}
        />
        <MetricCard
          title="Sections"
          value={metrics?.sectionCount ?? 0}
          icon={Layers}
          href={sh(SCHOOL_HEAD_ROUTES.schoolGradeLevels)}
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
          href={sh(SCHOOL_HEAD_ROUTES.schoolYears)}
        />
      </div>

      {(metrics?.setupTasks.length ?? 0) > 0 ? (
        <Callout title="Finish setting up your school">
          <div className="mt-2 flex flex-wrap gap-2">
            {metrics!.setupTasks.map((t) => (
              <Button
                key={t.id}
                asChild
                size="sm"
                variant="outline"
                // The amber callout already carries the tint; the buttons sit on
                // card white so they read as actions rather than more banner.
                className="bg-card text-foreground"
              >
                <PrefetchLink
                  href={
                    isSuperAdminView
                      ? `${t.href}?schoolId=${schoolId}`
                      : t.href
                  }
                  prefetch={true}
                >
                  {t.label}
                </PrefetchLink>
              </Button>
            ))}
          </div>
        </Callout>
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
      <div className="grid gap-4 lg:grid-cols-2">
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
            <DashboardBarChart data={charts!.readingTrend} color="hsl(262 83% 58%)" />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
              color="hsl(var(--secondary))"
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
              title="No notices yet"
              description="Post an announcement for your school."
              actionHref={sh(SCHOOL_HEAD_ROUTES.announcements)}
              actionLabel="Post an announcement"
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
                    {toDateKey(a.createdAt)}
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
              title="Nothing audited yet"
              description="Audited school actions will appear here."
              actionHref={sh(SCHOOL_HEAD_ROUTES.audit)}
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
                    {toDateKey(a.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(activity?.pendingAralProfiles ?? 0) > 0 ? (
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
              {activity!.pendingAralProfiles} ARAL learner(s) still need Sections
              B–E profiling.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
