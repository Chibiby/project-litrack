import { Suspense, type ReactNode } from "react";
import { Surface } from "@/components/ui/surface";
import { Callout } from "@/components/ui/callout";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { cn } from "@/lib/utils";
import {
  getSchoolHeadOverview,
  buildSchoolHeadAttention,
  type SchoolHeadAttentionHrefs,
} from "@/lib/dashboard/school-head-overview";
import { getSchoolHeadAttendanceMix } from "@/lib/dashboard/aggregates";
import { AdviserlessSectionsNotice } from "@/components/school-head/adviserless-sections-notice";
import type { SchoolHeadView } from "@/components/school-head/school-head-page";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { CalendarCard } from "@/components/dashboard/teacher/calendar-card";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import {
  ListChecks,
  Users,
  GraduationCap,
  Layers,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { SchoolHeadGreetingHero } from "./greeting-hero";
import { SchoolHeadStatRow } from "./stat-row";
import { AralCoveragePanel, IpCoveragePanel, SchoolAttendancePanel } from "./overview-panels";
import { SchoolAttentionPanel, SchoolQuickActionsPanel } from "./attention-panel";
import {
  ipLearnersHref,
  teachersHref,
  teachersPendingHref,
  schoolGradeLevelsHref,
  aralHref,
  schoolYearsHref,
  profilingHref,
  announcementsHref,
  transferHref,
  reportsHref,
} from "./hrefs";
import {
  SchoolHeadChartsSection,
  SchoolHeadIpSection,
  SchoolHeadRecentActivitySection,
} from "@/components/dashboard/school-head-dashboard-sections";
import { ChartSectionSkeleton, DualListCardSkeleton } from "@/components/loading";

/** Active school year, grade count and section count, the way the hero meta chip reads it. */
function buildMetaLabel(data: { activeYear: { label: string } | null; gradeCount: number; sectionCount: number }): string {
  if (!data.activeYear) return "No active school year";
  const grades = `${data.gradeCount} grade level${data.gradeCount === 1 ? "" : "s"}`;
  const sections = `${data.sectionCount} section${data.sectionCount === 1 ? "" : "s"}`;
  return `SY ${data.activeYear.label} · ${grades} · ${sections}`;
}

/**
 * Awaited directly by the page rather than rendered as a Suspense child: the
 * greeting hero must resolve before `SchoolHeadPage` renders so it can be
 * handed through the `hero` prop — the Super Admin badge row renders between
 * `hero` and `children` (`school-head-page.tsx`), so the hero cannot be
 * folded into `children` without pushing that badge to the bottom of the
 * page (the defect this split fixes). One data pass: `getSchoolHeadOverview`
 * and `getSchoolHeadAttendanceMix` are read once here and shared by both the
 * returned `hero` and `body`, exactly as `loadAralPage`
 * (`src/app/school-head/(app)/aral/page.tsx`) and `loadKinderChecklistView`
 * (`src/app/school-head/(app)/terms-reports/kinder/page.tsx`) share one read
 * between their own `hero`/`body` pair.
 *
 * The three restyled sections (charts, IP, recent activity) keep their own
 * independent `<Suspense>` boundaries in `body` — they already stream
 * separately and already have skeletons, so losing the *outer* in-page
 * Suspense that used to wrap the whole body is an accepted trade: the route's
 * own `src/app/school-head/(app)/loading.tsx` already renders
 * `SchoolHeadDashboardSkeleton` as the boundary for first paint, the same
 * trade `loadAralPage` and `loadKinderChecklistView` make.
 */
export async function loadSchoolHeadDashboard({
  view,
  displayName,
  bannerSrc,
}: {
  view: SchoolHeadView;
  /** The head's first name — or, for a Super Admin drilling in, the school's name. */
  displayName: string;
  bannerSrc: string;
}): Promise<{ hero: ReactNode; body: ReactNode }> {
  let data: Awaited<ReturnType<typeof getSchoolHeadOverview>> | null = null;
  let attendanceMix: Awaited<ReturnType<typeof getSchoolHeadAttendanceMix>> | null = null;
  try {
    [data, attendanceMix] = await Promise.all([
      getSchoolHeadOverview(view.schoolId),
      getSchoolHeadAttendanceMix(view.schoolId),
    ]);
  } catch (err) {
    console.error("[loadSchoolHeadDashboard] failed to load:", err);
  }

  if (!data || !attendanceMix) {
    return {
      hero: null,
      body: (
        <Surface as="section" className="px-5 py-10 text-center">
          <h1 className="text-base font-semibold text-foreground">
            Your dashboard could not be loaded.
          </h1>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            The connection to the records database failed. Your data is safe —
            reload the page, and tell your Super Admin if it keeps happening.
          </p>
        </Surface>
      ),
    };
  }

  const attentionHrefs: SchoolHeadAttentionHrefs = {
    // The approvals row is the only consumer of this href, and it exists to put
    // the head in front of the pending queue — the Active tab shows none of the
    // teachers it just counted.
    teachers: teachersPendingHref(view),
    gradeLevels: schoolGradeLevelsHref(view),
    years: schoolYearsHref(view),
    profiling: profilingHref(view),
  };
  const attentionItems = buildSchoolHeadAttention(data, attentionHrefs);

  const quote = pickQuote();
  // The calendar shows the next quote in the list, so it never repeats the hero.
  const calendarQuote =
    DASHBOARD_QUOTES[(DASHBOARD_QUOTES.indexOf(quote) + 1) % DASHBOARD_QUOTES.length];

  const hero = (
    <SchoolHeadGreetingHero
      firstName={displayName}
      todayKey={data.todayKey}
      bannerSrc={bannerSrc}
      quote={quote}
      meta={buildMetaLabel(data)}
      isSuperAdminView={view.isSuperAdminView}
    />
  );

  const body = (
    <div className="flex flex-col gap-4">
      <AdviserlessSectionsNotice sections={data.adviserlessSections} />

      {!data.activeYear ? (
        <Callout title="No active school year">
          New learners will not get an Enrollment until you set one.{" "}
          <PrefetchLink
            href={schoolYearsHref(view)}
            prefetch={true}
            className="font-medium underline"
          >
            Manage school years
          </PrefetchLink>
        </Callout>
      ) : null}

      {/*
        Desktop: the hero art ends in a soft cloud fade, so the cards rise
        into its lower edge instead of leaving an empty band under it. Not for
        a Super Admin view, though: the frame renders its own badge row
        between the hero and this block there, and pulling the stat row up
        `-4rem` would run it under that badge's text instead of the hero.
      */}
      <div
        className={cn(
          "relative z-10 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]",
          !view.isSuperAdminView && "lg:-mt-16"
        )}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SchoolHeadStatRow>
            <StatCard
              title="Learners"
              value={data.learnerCount}
              hint="All learners in the school"
              icon={ListChecks}
              tone="amber"
              decor="bars"
              action={{ label: "View learners", href: ipLearnersHref(view) }}
            />
            <StatCard
              title="Teachers"
              value={data.teacherCount}
              hint="Active teaching accounts"
              icon={Users}
              tone="primary"
              decor="people"
              action={{ label: "Manage teachers", href: teachersHref(view) }}
            />
            <StatCard
              title="Grade levels"
              value={data.gradeCount}
              hint="Grades this school offers"
              icon={GraduationCap}
              tone="emerald"
              decor="sprout"
              action={{ label: "View grade levels", href: schoolGradeLevelsHref(view) }}
            />
            <StatCard
              title="Sections"
              value={data.sectionCount}
              hint="Across all grades"
              icon={Layers}
              tone="emerald"
              decor="wave"
              action={{ label: "View sections", href: schoolGradeLevelsHref(view) }}
            />
            <StatCard
              title="ARAL learners"
              value={data.aralCount}
              hint="In the ARAL program"
              icon={Sparkles}
              tone="violet"
              decor="sprout"
              action={{ label: "View ARAL program", href: aralHref(view) }}
            />
            <StatCard
              title="Pending approvals"
              value={data.pendingTeacherCount}
              hint="Waiting on your decision"
              icon={UserPlus}
              tone={data.pendingTeacherCount > 0 ? "amber" : "neutral"}
              decor="clock"
              action={{ label: "Review approvals", href: teachersPendingHref(view) }}
            />
          </SchoolHeadStatRow>

          {/* flex-1: the panels absorb any height the rail has over this column.
              Two-up from sm through lg (this column is full width there, no
              rail yet). One-up at xl: the rail (`xl:grid-cols-[minmax(0,1fr)_20rem]`
              above) narrows this column to ~640px, and each panel's header
              (icon + title + the standalone period pill) and donut+legend row
              need more like 400px to stay on comfortable lines, so two-up
              there crushes both to ~290px. Two-up again at 2xl once the column
              is wide enough. The odd third panel spans both columns from sm
              so it reads as a full-width summary instead of a half-width
              orphan. `xl:col-span-1` on the third panel matters, not just
              decoration: at `xl` the grid itself drops to one explicit
              column, and a `col-span-2` there would ask Grid for a column
              the template doesn't have — Grid then fabricates an implicit,
              content-sized second column for every row to satisfy it,
              which is what was crushing the first two panels' widths. */}
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-1 2xl:grid-cols-2">
            <AralCoveragePanel
              aralCount={data.aralCount}
              learnerCount={data.learnerCount}
              href={aralHref(view)}
            />
            <IpCoveragePanel
              ipLearners={data.ipLearners}
              totalLearners={data.totalLearners}
              ipPercent={data.ipPercent}
              href={ipLearnersHref(view)}
            />
            <SchoolAttendancePanel
              mix={attendanceMix}
              href={aralHref(view)}
              className="sm:col-span-2 xl:col-span-1 2xl:col-span-2"
            />
          </div>
        </div>

        {/* Phones and tablets: the rail follows the panels. Desktop: it sits a
            little higher than the cards, like the teacher dashboard's rail. */}
        <aside className="flex min-w-0 flex-col gap-4 xl:relative xl:z-10 xl:-mt-4">
          <div className="hidden xl:block">
            <CalendarCard todayKey={data.todayKey} quote={calendarQuote} />
          </div>
          <SchoolAttentionPanel items={attentionItems} />
        </aside>
      </div>

      <SchoolQuickActionsPanel
        isSuperAdminView={view.isSuperAdminView}
        announcementsHref={announcementsHref(view)}
        transferHref={transferHref(view)}
        teachersHref={teachersHref(view)}
        reportsHref={reportsHref(view)}
      />

      <Suspense
        fallback={
          <>
            <ChartSectionSkeleton columns={2} />
            <ChartSectionSkeleton columns={2} />
          </>
        }
      >
        <SchoolHeadChartsSection schoolId={view.schoolId} />
      </Suspense>

      <Suspense fallback={<ChartSectionSkeleton columns={2} />}>
        <SchoolHeadIpSection schoolId={view.schoolId} isSuperAdminView={view.isSuperAdminView} />
      </Suspense>

      <Suspense fallback={<DualListCardSkeleton className="md:max-lg:grid-cols-2" />}>
        <SchoolHeadRecentActivitySection
          schoolId={view.schoolId}
          isSuperAdminView={view.isSuperAdminView}
        />
      </Suspense>
    </div>
  );

  return { hero, body };
}
