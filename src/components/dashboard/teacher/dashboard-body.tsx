import {
  getTeacherOverview,
  buildDashboardTasks,
} from "@/lib/dashboard/teacher-overview";
import { Surface } from "@/components/ui/surface";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { GradeLevelBarChart } from "@/components/dashboard/lazy-charts";
import { GraduationCap, Sparkles, UserRoundCheck, Users } from "lucide-react";
import { GreetingHeader } from "./greeting-header";
import { StatCard, StatCardRow } from "./stat-cards";
import { AttendanceOverviewPanel, ReadingOverviewPanel } from "./overview-panels";
import { UpcomingTasksPanel, QuickActionsPanel } from "./tasks-panel";
import { NoticeStrip } from "./notice-strip";
import {
  aralAttendanceHref,
  aralReadingHref,
  gradeProfilingHref,
} from "./hrefs";

/*
 * DIRECTION CONTRACT — teacher dashboard, seed db875848
 *
 * THESIS        The approved comp is the spec. This surface reproduces its
 *               layout exactly — four stat cards, two period panels, a grade
 *               chart beside tasks and quick actions, a closing notice strip —
 *               and adapts LITRACK's real data into it rather than composing
 *               a structure of its own.
 * OWN-WORLD     LITRACK's committed identity: blue-gray field, white Surface
 *               panels, blue primary, amber secondary, violet reserved for
 *               ARAL. Colour lives in icon tiles, badges, bar segments and
 *               links, never in a tinted card body. Inter, tabular numerals.
 * STORY         A teacher reads the week's state at a glance, sees what is
 *               outstanding, and clicks into the entry screen that clears it.
 * FIRST VIEWPORT Greeting and today's date, then the four stat cards, then the
 *               attendance and reading panels side by side.
 * FORM          Reproduction of the user-supplied comp; the pinned brief
 *               outranks the roll. Seed db875848.
 * FINISH        unreviewed and undocumented is unfinished; this build ends with
 *               the finish review, the verdict, DESIGN.md, and every shipping
 *               raster carrying its provenance
 *
 * TRUTH NOTE    The comp's "Automatic Data Lock" panel and its "Locked" task
 *               badge describe a lock/deadline model the schema does not have.
 *               Those two slots keep their position and treatment; their copy
 *               states the real recording cadence instead. Everything else on
 *               the page is backed by live data.
 */

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
}: {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  firstName: string;
  subtitle?: string;
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

  return (
    <>
      <GreetingHeader
        firstName={firstName}
        todayKey={data.todayKey}
        subtitle={subtitle}
      />

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
          icon={Sparkles}
          tone="emerald"
          action={{
            label: "View ARAL learners",
            href: gradeProfilingHref(data.primaryAralGradeId),
          }}
        />
        <StatCard
          title="Pending Profiles"
          value={data.pendingAralProfiles}
          hint="Without ARAL profile"
          icon={UserRoundCheck}
          tone="primary"
          action={{
            label: "Manage profiles",
            href: gradeProfilingHref(data.primaryAralGradeId),
          }}
        />
      </StatCardRow>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AttendanceOverviewPanel data={data} href={attendanceHref} />
        <ReadingOverviewPanel data={data} href={readingHref} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[7fr_5fr] xl:grid-cols-[8fr_4fr]">
        <div className="flex flex-col gap-4">
          <Surface as="section" className="flex flex-1 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Learners by Grade Level
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Distribution of your learners
                </p>
              </div>
              <span className="shrink-0 rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {data.schoolYearLabel
                  ? `SY ${data.schoolYearLabel}`
                  : "No active school year"}
              </span>
            </div>
            {/* min-h keeps the plot readable when the row is short; flex-1
                lets it absorb the extra height when the task column is taller,
                so the card never ends in a band of dead space. */}
            <div className="min-h-[260px] flex-1 px-2 pb-4 pt-4 sm:px-4">
              {chartData.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm leading-relaxed text-muted-foreground">
                  Grade levels are created by your School Head. Once they exist,
                  your learners appear here by grade.
                </p>
              ) : (
                <GradeLevelBarChart data={chartData} height="100%" />
              )}
            </div>
          </Surface>

          <NoticeStrip />
        </div>

        <div className="flex flex-col gap-4">
          <UpcomingTasksPanel tasks={tasks} viewAllHref={reportsHref} />
          <QuickActionsPanel
            attendanceHref={attendanceHref}
            readingHref={readingHref}
            reportsHref={reportsHref}
          />
        </div>
      </div>
    </>
  );
}
