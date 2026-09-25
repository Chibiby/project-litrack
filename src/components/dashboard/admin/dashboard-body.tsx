import { Suspense, type ReactNode } from "react";
import {
  AlertTriangle,
  GraduationCap,
  School,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import { getAdminMetricCounts } from "@/lib/dashboard/aggregates";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { Callout } from "@/components/ui/callout";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { CalendarCard } from "@/components/dashboard/teacher/calendar-card";
import { SchoolHeadGreetingHero } from "@/components/dashboard/school-head/greeting-hero";
import { SchoolHeadStatRow } from "@/components/dashboard/school-head/stat-row";
import { SchoolAttentionPanel } from "@/components/dashboard/school-head/attention-panel";
import {
  AdminChartsSection,
  AdminIpAdvisorySection,
  AdminRecentSchoolsSection,
} from "@/components/dashboard/admin-dashboard-sections";
import { ChartSectionSkeleton, ListCardSkeleton } from "@/components/loading";
import { AdminQuickActionsPanel } from "./quick-actions-panel";
import { buildAdminAttention, buildAdminMetaLabel } from "./attention";

/**
 * Loads the Super Admin dashboard's headline figures once and returns the hero
 * and body separately, the way `loadSchoolHeadDashboard` does. Composes the
 * School Head dashboard's own pieces (greeting hero, six-card stat row,
 * attention panel, calendar) rather than forking them.
 */
export async function loadAdminDashboard({
  firstName,
}: {
  firstName: string;
}): Promise<{ hero: ReactNode; body: ReactNode }> {
  let metrics: Awaited<ReturnType<typeof getAdminMetricCounts>> | null = null;
  try {
    metrics = await getAdminMetricCounts();
  } catch (err) {
    console.error("[loadAdminDashboard] failed to load:", err);
  }

  const todayKey = formatLocalDateKey(schoolToday());
  const quote = pickQuote();
  const calendarQuote =
    DASHBOARD_QUOTES[(DASHBOARD_QUOTES.indexOf(quote) + 1) % DASHBOARD_QUOTES.length];

  const hero = (
    <SchoolHeadGreetingHero
      firstName={firstName}
      todayKey={todayKey}
      bannerSrc={teacherBannerSrc(null)}
      quote={quote}
      subtitle="Here's how every school is doing today."
      meta={buildAdminMetaLabel(metrics)}
    />
  );

  const pending = metrics?.pendingTeacherApprovals ?? 0;
  const inactive = metrics?.schoolsInactive ?? 0;

  const body = (
    <div className="flex min-w-0 flex-col gap-4">
      {!metrics ? (
        <Callout title="Some figures could not be loaded">
          The connection to the records database failed. Your data is safe — reload the
          page to try again.
        </Callout>
      ) : null}

      {/* Desktop: the stat row rises into the hero's cloud fade, as on the
          School Head and teacher dashboards. */}
      <div className="relative z-10 grid grid-cols-1 min-w-0 gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SchoolHeadStatRow>
            <StatCard
              title="Schools"
              value={metrics?.schoolsTotal ?? 0}
              hint={`${metrics?.schoolsActive ?? 0} active · ${inactive} inactive`}
              icon={School}
              tone="primary"
              decor="bars"
              action={{ label: "View schools", href: "/admin/schools" }}
            />
            <StatCard
              title="School Heads"
              value={metrics?.schoolHeadCount ?? 0}
              hint="Sign-in accounts"
              icon={UserCog}
              tone="emerald"
              decor="people"
              action={{ label: "View heads", href: "/admin/accounts?role=SCHOOL_HEAD" }}
            />
            <StatCard
              title="Teachers"
              value={metrics?.teacherCount ?? 0}
              hint="Active teaching accounts"
              icon={Users}
              tone="primary"
              decor="people"
              action={{ label: "View teachers", href: "/admin/accounts?role=TEACHER" }}
            />
            <StatCard
              title="Learners"
              value={metrics?.learnerCount ?? 0}
              hint="Across every school"
              icon={GraduationCap}
              tone="amber"
              decor="wave"
              action={{ label: "IP learners", href: "/admin/ip-learners" }}
            />
            <StatCard
              title="ARAL learners"
              value={metrics?.aralCount ?? 0}
              hint="In the ARAL program"
              icon={Sparkles}
              tone="violet"
              decor="sprout"
              href="/admin/summary"
            />
            <StatCard
              title="Pending teachers"
              value={pending}
              hint="Awaiting School Head approval"
              icon={AlertTriangle}
              tone={pending > 0 ? "amber" : "neutral"}
              decor="clock"
              action={{ label: "Review", href: "/admin/accounts?role=TEACHER" }}
            />
          </SchoolHeadStatRow>

          <Suspense fallback={<ChartSectionSkeleton columns={2} />}>
            <AdminIpAdvisorySection />
          </Suspense>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 xl:relative xl:z-10 xl:-mt-4">
          <div className="hidden xl:block">
            <CalendarCard todayKey={todayKey} quote={calendarQuote} />
          </div>
          <SchoolAttentionPanel items={buildAdminAttention(metrics)} />
        </aside>
      </div>

      <AdminQuickActionsPanel />

      <Suspense fallback={<ChartSectionSkeleton columns={2} />}>
        <AdminChartsSection />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton items={5} />}>
        <AdminRecentSchoolsSection />
      </Suspense>
    </div>
  );

  return { hero, body };
}
