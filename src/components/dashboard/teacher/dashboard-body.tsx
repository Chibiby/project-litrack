import {
  getTeacherOverview,
  buildDashboardTasks,
} from "@/lib/dashboard/teacher-overview";
import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { FLOATING_TEACHER_CARD } from "@/lib/teachers/floating-copy";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { GradeLevelBarChart } from "@/components/dashboard/lazy-charts";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  GraduationCap,
  Star,
  UserRound,
  Users,
} from "lucide-react";
import { GreetingHero } from "./greeting-hero";
import { StatCard, StatCardRow } from "./stat-cards";
import { AttendanceOverviewPanel, ReadingOverviewPanel } from "./overview-panels";
import { UpcomingTasksPanel, QuickActionsPanel } from "./tasks-panel";
import { CalendarCard } from "./calendar-card";
import {
  aralAttendanceHref,
  aralReadingHref,
  aralRosterHref,
  aralProfilingHref,
} from "./hrefs";

/*
 * DIRECTION CONTRACT — teacher dashboard, LITRACK v2.0.0
 *
 * THESIS        The owner's v2 mockups (desktop and mobile) are the spec. The
 *               layout reproduces them — hero banner, four stat cards, two
 *               donut panels, a calendar and tasks rail, a grade chart beside
 *               quick actions — filled with LITRACK's real data.
 * TRUTH NOTES   No month-over-month trend lines (nothing computes them). No
 *               "Overdue" badge (LITRACK stores no deadline). Pending Profiles
 *               opens ARAL Profiling on the learners still without one.
 *               "Generate Report" opens Reports, where exports live.
 * SPEC          docs/superpowers/specs/2026-09-15-litrack-v2-teacher-dashboard-design.md
 */

/** Adding a learner happens from the roster's add menu; there is no deep link to the dialog. */
const ADD_LEARNER_HREF = "/teacher/learners";

/**
 * The whole dashboard reads from one cached snapshot, so the stat cards, the
 * panels, the chart and the task badges can never report different numbers.
 */
export async function TeacherDashboardBody({
  schoolId,
  teacherId,
  isSuperAdmin,
  firstName,
  subtitle,
  bannerSrc,
}: {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  firstName: string;
  subtitle?: string;
  /**
   * Hero art, chosen from the teacher's profile gender by the page. A promise
   * lets the page start that lookup without holding back the overview below.
   * It must not reject: the page maps a failed read to the default banner.
   */
  bannerSrc: string | Promise<string>;
}) {
  let data: Awaited<ReturnType<typeof getTeacherOverview>> | null = null;
  // Both reads are in flight together. Awaiting the banner first made the
  // overview wait one extra database round trip on every dashboard load.
  const bannerPromise = Promise.resolve(bannerSrc);
  try {
    data = await getTeacherOverview({ schoolId, teacherId, isSuperAdmin });
  } catch (err) {
    console.error("[TeacherDashboardBody] failed to load:", err);
  }
  const resolvedBannerSrc = await bannerPromise;

  if (!data) {
    return (
      <Surface as="section" className="px-5 py-10 text-center">
        <h1 className="text-base font-semibold text-foreground">
          Your dashboard could not be loaded.
        </h1>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          The connection to the records database failed. Your data is safe —
          reload the page, and tell your School Head if it keeps happening.
        </p>
      </Surface>
    );
  }

  const attendanceHref = aralAttendanceHref(data.primaryAralGradeId);
  const readingHref = aralReadingHref(data.primaryAralGradeId);
  const reportsHref = "/teacher/reports";

  const tasks = buildDashboardTasks(data, {
    reading: readingHref,
    attendance: attendanceHref,
    reports: reportsHref,
  });

  const chartData = data.gradeDistribution.map((g) => ({
    name: GRADE_LEVEL_LABELS[g.name] ?? g.name,
    value: g.value,
  }));

  // §5: a floating teacher — no advisory section, and no grade reached through
  // an ARAL designation either. Every panel below would render a zero, a chart
  // with no bars and a task list of things they cannot do, which reads as the
  // dashboard being broken rather than as an accurate account of their
  // situation.
  //
  // The greeting stays: it is the one part of this page that is still true, and
  // dropping it would make a teacher who has just signed in wonder whether they
  // signed in as themselves.
  if (!isSuperAdmin && data.gradeCount === 0) {
    return (
      <>
        <GreetingHero
          firstName={firstName}
          todayKey={data.todayKey}
          subtitle={subtitle}
          bannerSrc={resolvedBannerSrc}
          quote={pickQuote()}
        />
        <Surface as="section" className="mt-4 rounded-lg px-5 py-10 text-center">
          <h1 className="text-base font-semibold text-foreground">
            {FLOATING_TEACHER_CARD.title}
          </h1>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            {FLOATING_TEACHER_CARD.description}
          </p>
          <Link
            href={FLOATING_TEACHER_CARD.actionHref}
            className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {FLOATING_TEACHER_CARD.actionLabel}
          </Link>
        </Surface>
      </>
    );
  }

  const quote = pickQuote();
  // The calendar shows the next quote in the list, so it never repeats the hero.
  const calendarQuote =
    DASHBOARD_QUOTES[(DASHBOARD_QUOTES.indexOf(quote) + 1) % DASHBOARD_QUOTES.length];

  return (
    <div className="flex flex-col gap-4">
      <GreetingHero
        firstName={firstName}
        todayKey={data.todayKey}
        subtitle={subtitle}
        bannerSrc={resolvedBannerSrc}
        quote={quote}
      />

      {/* Desktop: the hero art ends in a soft cloud fade, so the cards rise
          into its lower edge instead of leaving an empty band under it. */}
      <div className="relative z-10 grid gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <StatCardRow>
            <StatCard
              title="Your Grades"
              value={data.gradeCount}
              hint={data.gradeCount === 1 ? "Assigned grade" : "Assigned grades"}
              icon={GraduationCap}
              tone="violet"
              action={{ label: "View grade details", href: "/teacher/learners" }}
            />
            <StatCard
              title="Total Learners"
              value={data.totalLearners}
              hint="All learners in your care"
              icon={Users}
              tone="amber"
              action={{ label: "View all learners", href: "/teacher/learners" }}
            />
            <StatCard
              title="ARAL Learners"
              value={data.aralLearners}
              hint="In the ARAL program"
              icon={Star}
              tone="emerald"
              action={{
                label: "View ARAL learners",
                href: aralRosterHref(data.primaryAralGradeId),
              }}
            />
            <StatCard
              title="Pending Profiles"
              value={data.pendingAralProfiles}
              hint="Without ARAL profile"
              icon={UserRound}
              tone="primary"
              action={{ label: "Complete profiles", href: aralProfilingHref() }}
            />
          </StatCardRow>

          {/* flex-1: the panels absorb any height the rail has over this column,
              so the chart row starts right under both. */}
          <div className="grid flex-1 grid-cols-2 gap-3 sm:gap-4">
            <AttendanceOverviewPanel data={data} href={attendanceHref} />
            <ReadingOverviewPanel data={data} href={readingHref} />
          </div>
        </div>

        {/* Phones and tablets: tasks follow the panels (image 4). Desktop:
            the rail sits a little higher than the cards (image 3). */}
        <aside className="flex min-w-0 flex-col gap-4 xl:relative xl:z-10 xl:-mt-4">
          <div className="hidden xl:block">
            <CalendarCard todayKey={data.todayKey} quote={calendarQuote} />
          </div>
          <UpcomingTasksPanel tasks={tasks} viewAllHref={reportsHref} />
        </aside>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <GradeChartCard
          // Phones and tablets: after Quick Actions. Desktop: beside it.
          className="order-2 flex xl:order-none"
          chartData={chartData}
          schoolYearLabel={data.schoolYearLabel}
          totalLearners={data.totalLearners}
          gradeCount={data.gradeCount}
        />
        <div className="order-1 xl:order-none">
          <QuickActionsPanel
            attendanceHref={attendanceHref}
            addLearnerHref={ADD_LEARNER_HREF}
            reportsHref={reportsHref}
          />
        </div>
      </div>
    </div>
  );
}

function GradeChartCard({
  className,
  chartData,
  schoolYearLabel,
  totalLearners,
  gradeCount,
}: {
  className?: string;
  chartData: { name: string; value: number }[];
  schoolYearLabel: string | null;
  totalLearners: number;
  gradeCount: number;
}) {
  return (
    <Surface as="section" className={cn("flex-col rounded-lg", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-md icon-glass text-aral-strong"
          >
            <BarChart3 className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Learners by Grade Level
            </h2>
            <p className="text-sm text-muted-foreground">Distribution of your learners</p>
          </div>
        </div>
        <span className="shrink-0 rounded-md border border-border/80 px-3 py-1.5 text-xs font-medium text-foreground">
          {schoolYearLabel ? `SY ${schoolYearLabel}` : "No active school year"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-3 pb-4 pt-3 md:flex-row md:items-center md:px-5 xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-center">
        {/* min-h keeps the plot readable; flex-1 lets it absorb spare height. */}
        <div className="h-[200px] min-h-[200px] min-w-0 flex-1">
          {chartData.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm leading-relaxed text-muted-foreground">
              Grade levels are created by your School Head. Once they exist,
              your learners appear here by grade.
            </p>
          ) : (
            // The chart measures its own width and abbreviates the axis
            // labels whenever it is too narrow for them, phone through xl.
            <GradeLevelBarChart data={chartData} height="100%" />
          )}
        </div>
        <div className="shrink-0 md:w-64 xl:w-auto 2xl:w-64">
          <div className="flex items-center gap-3 rounded-lg bg-aral-50 p-4 dark:bg-aral-950/40">
            <Users aria-hidden className="size-8 shrink-0 text-aral-600 dark:text-aral-300" />
            <div>
              <p className="text-lg font-bold text-aral-900 dark:text-aral-100">
                {totalLearners} {totalLearners === 1 ? "learner" : "learners"}
              </p>
              <p className="text-sm text-muted-foreground">
                across <span className="font-semibold text-warning-700 dark:text-warning-300">{gradeCount}</span>{" "}
                {gradeCount === 1 ? "grade level" : "grade levels"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}
