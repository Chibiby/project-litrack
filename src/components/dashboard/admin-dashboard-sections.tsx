import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  getAdminActivitySeries,
  getAdminRecentSchools,
  getAdminIpAndAdvisoryMetrics,
} from "@/lib/dashboard/aggregates";
import { getLearnersSummary } from "@/lib/admin/management";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
} from "@/components/dashboard/lazy-charts";
import {
  School,
  Users,
  ChevronRight,
  CalendarCheck,
  GraduationCap,
  UserX,
} from "lucide-react";

/**
 * The Super Admin dashboard sections that fetch on their own and stream
 * behind their own `<Suspense>`: enrollment and staffing, the two trend charts and the
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
        className="min-w-0 rounded-lg"
      >
        {!hasSchools ? (
          <EmptyState
            title="No data yet"
            description="Create a school to see status breakdown."
            actionHref={ADMIN_ROUTES.newSchool}
            actionLabel="New school"
            icon={School}
          />
        ) : (
          <DashboardBarChart data={activity!.schoolStatus} />
        )}
      </ChartCard>
      <ChartCard
        title="Attendance recorded (7 days)"
        description="Learners marked per day, all schools"
        className="min-w-0 rounded-lg"
      >
        {!hasActivity ? (
          <EmptyState
            title="No attendance this week"
            description="The trend appears once teachers record attendance."
            icon={CalendarCheck}
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

/** Axis label: "Grade 3" → "G3", "Kinder" → "K". Local: the charts module is client-only. */
function shortGradeLabel(label: string): string {
  if (label === "Kinder") return "K";
  const m = /^Grade (\d+)$/.exec(label);
  return m ? `G${m[1]}` : label;
}

/** Schools with the heaviest load: most enrolled learners per active teacher. */
function busiestSchools(
  rows: readonly {
    schoolId: string;
    name: string;
    totalLearners: number;
    activeTeachers: number;
    learnersPerTeacher: string;
  }[],
  n: number
) {
  return rows
    .filter((r) => r.activeTeachers > 0 && r.totalLearners > 0)
    .map((r) => ({ ...r, ratio: r.totalLearners / r.activeTeachers }))
    .sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name))
    .slice(0, n);
}

/**
 * Enrollment and staffing at a glance: learners per teacher, schools with
 * learners but no active teacher, learners by grade, and the schools carrying
 * the most learners per teacher. IP figures live on Management → IP Learners.
 */
export async function AdminLearnerMixSection() {
  const [staffing, summary] = await Promise.all([
    getAdminIpAndAdvisoryMetrics().catch((err) => {
      console.error("[AdminLearnerMixSection] failed to load staffing:", err);
      return null;
    }),
    getLearnersSummary().catch((err) => {
      console.error("[AdminLearnerMixSection] failed to load learners:", err);
      return null;
    }),
  ]);

  const busiest = busiestSchools(staffing?.schools ?? [], 5);
  const noTeacher = (staffing?.schools ?? []).filter(
    (r) => r.activeTeachers === 0 && r.totalLearners > 0
  ).length;
  const grades = (summary?.byGrade ?? [])
    .filter((g) => g.grade !== "UNASSIGNED")
    .map((g) => ({ name: shortGradeLabel(g.label), value: g.count }));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          title="Learners per teacher"
          value={staffing?.national.learnersPerTeacher ?? "—"}
          hint={`${(staffing?.national.totalLearners ?? 0).toLocaleString()} enrolled · ${(staffing?.national.activeTeachers ?? 0).toLocaleString()} active teachers`}
          icon={Users}
          tone="primary"
          denseOnPhone
          href={ADMIN_ROUTES.teachers}
        />
        <StatCard
          title="Schools with no teacher"
          value={noTeacher.toLocaleString()}
          hint={noTeacher > 0 ? "Learners, no active teacher" : "All schools are staffed"}
          icon={UserX}
          tone={noTeacher > 0 ? "amber" : "emerald"}
          denseOnPhone
          href={ADMIN_ROUTES.schools}
        />
      </div>

      {/* One-up at xl, where the attention rail narrows this column; two-up
          again at 2xl once it is wide enough for a table beside a chart. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <ChartCard
          title="Learners by grade"
          description="Every learner, by current grade"
          action={
            <Button asChild size="sm" variant="outline" className="lg:h-9">
              <PrefetchLink href={ADMIN_ROUTES.learners}>View all</PrefetchLink>
            </Button>
          }
          className="min-w-0 rounded-lg"
        >
          {grades.length === 0 ? (
            <EmptyState
              title="No learners yet"
              description="Appears once schools add learners."
              icon={GraduationCap}
            />
          ) : (
            <DashboardBarChart data={grades} height={240} />
          )}
        </ChartCard>
        <ChartCard
          title="Most learners per teacher"
          description="Top 5 schools by enrolled learners per active teacher"
          action={
            <Button asChild size="sm" variant="outline" className="lg:h-9">
              <PrefetchLink href={ADMIN_ROUTES.schools}>Schools</PrefetchLink>
            </Button>
          }
          className="min-w-0 rounded-lg"
          contentClassName="p-0 sm:p-2"
        >
          {busiest.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No data yet"
                description="Appears once schools have enrolled learners and active teachers."
                icon={School}
              />
            </div>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>School</TableHead>
                      <TableHead numeric>Teachers</TableHead>
                      <TableHead numeric>Enrolled</TableHead>
                      <TableHead numeric>Per teacher</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {busiest.map((s) => (
                      <TableRow key={s.schoolId}>
                        <TableCell className="max-w-56 font-medium">
                          <CellText>{s.name}</CellText>
                        </TableCell>
                        <TableCell numeric>{s.activeTeachers.toLocaleString()}</TableCell>
                        <TableCell numeric>{s.totalLearners.toLocaleString()}</TableCell>
                        <TableCell numeric>{s.learnersPerTeacher}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="Most learners per teacher">
                  {busiest.map((s) => (
                    <StackedRow
                      key={s.schoolId}
                      title={s.name}
                      value={
                        <>
                          {s.learnersPerTeacher}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            per teacher
                          </span>
                        </>
                      }
                      meta={
                        <span className="tabular-nums">
                          {s.totalLearners.toLocaleString()} enrolled ·{" "}
                          {s.activeTeachers.toLocaleString()} teachers
                        </span>
                      }
                    />
                  ))}
                </StackedList>
              }
            />
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
    <Surface as="section" className="rounded-lg">
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
          <PrefetchLink href={ADMIN_ROUTES.schools}>All schools</PrefetchLink>
        </Button>
      </SurfaceHeader>
      <SurfaceBody className="p-3 sm:p-4">
        {recentSchools.length === 0 ? (
          <EmptyState
            title="No data yet"
            description="Create a school to enable drill-down."
            actionHref={ADMIN_ROUTES.newSchool}
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
                  className="flex min-h-12 items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
