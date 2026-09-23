import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  getSchoolHeadCharts,
  getSchoolHeadRecentActivity,
  getSchoolHeadIpMetrics,
} from "@/lib/dashboard/aggregates";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
  DashboardPieChart,
} from "@/components/dashboard/lazy-charts";
import { Users, GraduationCap, Megaphone, ClipboardList } from "lucide-react";
import { toDateKey } from "@/lib/utils";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { collapseKindsToOthers } from "@/lib/dashboard/ip-metrics";
import { schoolHeadHref, type SchoolHeadView } from "@/components/school-head/school-head-page";

/**
 * The three sections of the School Head dashboard that still fetch and render
 * on their own: charts, IP metrics, and recent activity. Steps 1–5 of
 * `docs/school-head-ui-rework.md` section 3.2 (hero, stat row, coverage
 * panels, attention rail, quick actions) live in
 * `src/components/dashboard/school-head/dashboard-body.tsx` instead, built off
 * `getSchoolHeadOverview` — this file's old `SchoolHeadMetricsSection` is
 * retired for exactly that reason, not merely restyled.
 *
 * T2.7: metric cards become stat cards, cards become surfaces, and the local
 * `schoolPath()` helper is gone in favour of `schoolHeadHref`. Every `where`
 * clause, cache tag and Suspense boundary below is byte-identical to before
 * this restyle — only the JSX changed.
 */

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

export async function SchoolHeadIpSection({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  let ip: Awaited<ReturnType<typeof getSchoolHeadIpMetrics>> | null = null;
  try {
    ip = await getSchoolHeadIpMetrics(schoolId);
  } catch (err) {
    console.error("[SchoolHeadIpSection] failed to load:", err);
  }

  const view: SchoolHeadView = { schoolId, schoolName: null, isSuperAdminView };
  const allRows = ip?.rows ?? [];
  const rows = [...allRows].sort((a, b) => b.ipLearners - a.ipLearners || a.key.localeCompare(b.key)).slice(0, 5);
  const kinds = collapseKindsToOthers(ip?.ipKinds ?? [], 5);
  const viewAllHref = schoolHeadHref(view, SCHOOL_HEAD_ROUTES.ipLearners);

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Learners per teacher"
          value={ip?.learnersPerTeacher ?? "—"}
          hint={`across ${ip?.activeTeachers ?? 0} active teachers`}
          icon={Users}
          tone="primary"
        />
      </div>
      <div className="grid gap-4 max-lg:grid-cols-1 lg:grid-cols-2">
      <ChartCard
        title="IP learners"
        description={`${ip?.ipLearners ?? 0} of ${ip?.totalLearners ?? 0} enrolled learners (${ip?.ipPercent ?? "—"})`}
        action={
          allRows.length > 5 ? (
            <Button asChild size="sm" variant="outline">
              <PrefetchLink href={viewAllHref}>View all</PrefetchLink>
            </Button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No data yet"
            description="Appears once learners are enrolled in the active school year."
            icon={Users}
          />
        ) : (
          // Below lg the card is too narrow for four columns, so cells stay on one
          // line and the table scrolls inside its own container (Table wraps itself
          // in overflow-auto) instead of wrapping "0 / 3" a character at a time.
          <Table className="max-lg:[&_td]:whitespace-nowrap max-lg:[&_th]:whitespace-nowrap max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
            <TableHeader>
              <TableRow>
                <TableHead>Grade</TableHead>
                <TableHead>Section</TableHead>
                <TableHead className="text-right">IP</TableHead>
                <TableHead className="text-right">IP %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.grade}</TableCell>
                  <TableCell>{r.section}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.ipLearners} / {r.totalLearners}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.ipPercent}
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
        action={
          <Button asChild size="sm" variant="outline">
            <PrefetchLink href={viewAllHref}>View all</PrefetchLink>
          </Button>
        }
      >
        {kinds.length === 0 ? (
          <EmptyState
            title="No data yet"
            description="Appears once enrolled learners have an IP ethnicity recorded."
            icon={Users}
          />
        ) : (
          <DashboardPieChart data={kinds} />
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

  const view: SchoolHeadView = { schoolId, schoolName: null, isSuperAdminView };
  const sh = (path: string) => schoolHeadHref(view, path);

  return (
    <div className="mb-6 grid gap-4 md:max-lg:grid-cols-2 lg:grid-cols-2">
      <Surface as="section" className="rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold text-foreground">Recent notices</h2>
        </SurfaceHeader>
        <SurfaceBody>
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
        </SurfaceBody>
      </Surface>
      <Surface as="section" className="rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold text-foreground">Recent activity</h2>
        </SurfaceHeader>
        <SurfaceBody>
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
        </SurfaceBody>
      </Surface>
    </div>
  );
}
