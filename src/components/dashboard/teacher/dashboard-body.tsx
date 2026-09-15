import {
  getTeacherOverview,
  buildDashboardTasks,
} from "@/lib/dashboard/teacher-overview";
import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { FLOATING_TEACHER_CARD } from "@/lib/teachers/floating-copy";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { GradeLevelBarChart } from "@/components/dashboard/lazy-charts";
import { pickQuote } from "@/lib/dashboard/quotes";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  GraduationCap,
  Heart,
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
 *               stays read-only per docs/aral-profile.md. "Generate Report"
 *               opens Reports, where exports live.
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
  /** Hero art, chosen from the teacher's profile gender by the page. */
  bannerSrc: string;
}) {
  let data: Awaited<ReturnType<typeof getTeacherOverview>> | null = null;
  try {
    data = await getTeacherOverview({ schoolId, teacherId, isSuperAdmin });
  } catch (err) {
    console.error("[TeacherDashboardBody] failed to load:", err);
  }

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
          bannerSrc={bannerSrc}
          quote={pickQuote()}
        />
        <Surface as="section" className="mt-4 rounded-2xl px-5 py-10 text-center">
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

  return (
    <div className="flex flex-col gap-4">
      <GreetingHero
        firstName={firstName}
        todayKey={data.todayKey}
        subtitle={subtitle}
        bannerSrc={bannerSrc}
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
            <CalendarCard todayKey={data.todayKey} quote={pickQuote()} />
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
    <Surface as="section" className={cn("flex-col rounded-2xl", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
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
        <span className="shrink-0 rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium text-foreground">
          {schoolYearLabel ? `SY ${schoolYearLabel}` : "No active school year"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-3 pb-4 pt-3 md:flex-row md:items-center md:px-5">
        {/* min-h keeps the plot readable; flex-1 lets it absorb spare height. */}
        <div className="h-[200px] min-w-0 flex-1">
          {chartData.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm leading-relaxed text-muted-foreground">
              Grade levels are created by your School Head. Once they exist,
              your learners appear here by grade.
            </p>
          ) : (
            <>
              <div className="h-full sm:hidden">
                <GradeLevelBarChart data={chartData} height="100%" shortLabels />
              </div>
              <div className="hidden h-full sm:block">
                <GradeLevelBarChart data={chartData} height="100%" />
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 md:w-64">
          <div className="flex items-center gap-3 rounded-xl bg-violet-50 p-4 dark:bg-violet-950/40">
            <Users aria-hidden className="size-8 shrink-0 text-violet-600 dark:text-violet-300" />
            <div>
              <p className="text-lg font-bold text-violet-900 dark:text-violet-100">
                {totalLearners} {totalLearners === 1 ? "learner" : "learners"}
              </p>
              <p className="text-sm text-muted-foreground">
                across <span className="font-semibold text-amber-600">{gradeCount}</span> grade level(s)
              </p>
            </div>
          </div>
          <p className="mt-4 px-1 text-sm leading-relaxed text-muted-foreground">
            Each learner is a unique story waiting to be written.{" "}
            <Heart aria-hidden className="inline size-3.5 fill-rose-400 text-rose-400" />
          </p>
        </div>
      </div>
    </Surface>
  );
}
