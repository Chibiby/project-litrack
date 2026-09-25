import { Suspense, cache } from "react";
import type { User } from "@prisma/client";
import { BarChart3, BookOpenCheck, CalendarDays, ShieldAlert, Users } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope, SummaryScope } from "@/lib/auth/admin-scope";
import { resolveSummaryScope } from "@/lib/auth/admin-scope";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { getDistrictNotifications } from "@/lib/district/notifications";
import { SUMMARY_FACETS } from "@/lib/summary/facets";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { monthKeyOf, monthLabel } from "@/lib/summary/shape/months";
import { cellOf } from "@/lib/summary/shape/rollup";
import type { FacetResult, SummaryGroup } from "@/lib/summary/types";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadGreetingHero } from "@/components/dashboard/school-head/greeting-hero";
import { SchoolAttentionPanel } from "@/components/dashboard/school-head/attention-panel";
import { CalendarCard } from "@/components/dashboard/teacher/calendar-card";
import { StatCard, StatCardRow } from "@/components/dashboard/teacher/stat-cards";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";
import { formatCount, formatPct } from "@/components/summary/summary-format";
import { NoDistrictsState } from "@/components/district/no-districts-state";
import { DistrictsPanel, type DistrictCard } from "@/components/district/districts-panel";
import { buildDistrictAttention } from "@/components/district/overview-attention";
import {
  DistrictAttentionSkeleton,
  DistrictStatSkeleton,
} from "@/components/district/overview-skeleton";

export const dynamic = "force-dynamic";

/** The single "All grades" row of an overall-level section. */
function overallRow(result: FacetResult, sectionId: string): SummaryGroup | null {
  const section = result.sections.find((s) => s.id === sectionId);
  return section?.table.groups.find((g) => !g.gradeType) ?? null;
}

// The flagged-schools tile and the attention rail read the same compliance
// result; one load per request serves both.
const loadCompliance = cache((scope: SummaryScope) =>
  SUMMARY_FACETS.compliance.load(scope, { level: "overall" })
);

async function LearnersTile({ scope }: { scope: SummaryScope }) {
  const result = await SUMMARY_FACETS.learners.load(scope, { level: "overall" });
  const total = overallRow(result, "gender")?.base ?? 0;
  return (
    <StatCard
      title="Learners"
      value={formatCount(total)}
      hint="Enrolled in the active school year"
      icon={Users}
      tone="amber"
      decor="bars"
      action={{ label: "Learners summary", href: DISTRICT_ROUTES.summary("learners") }}
    />
  );
}

async function AralLearnersTile({ scope, month }: { scope: SummaryScope; month: string }) {
  const result = await SUMMARY_FACETS["reading-behavior"].load(scope, { level: "overall", month });
  const total = overallRow(result, "wordRecognition")?.base ?? 0;
  return (
    <StatCard
      title="ARAL learners"
      value={formatCount(total)}
      hint="In the ARAL reading program"
      icon={BookOpenCheck}
      tone="violet"
      decor="sprout"
      action={{
        label: "Reading behaviour",
        href: `${DISTRICT_ROUTES.summary("reading-behavior")}?month=${month}`,
      }}
    />
  );
}

async function AttendanceTile({ scope, month }: { scope: SummaryScope; month: string }) {
  const result = await SUMMARY_FACETS.attendance.load(scope, {
    level: "overall",
    from: month,
    to: month,
  });
  const row = overallRow(result, "monthly");
  const rate = row ? cellOf(row, month).pct : null;
  return (
    <StatCard
      title="Attendance this month"
      value={formatPct(rate)}
      hint={`ARAL learners, ${monthLabel(month)}`}
      icon={CalendarDays}
      tone="violet"
      decor="wave"
      action={{
        label: "Attendance summary",
        href: `${DISTRICT_ROUTES.summary("attendance")}?from=${month}&to=${month}`,
      }}
    />
  );
}

async function ComplianceTile({ scope }: { scope: SummaryScope }) {
  const result = await loadCompliance(scope);
  const row = overallRow(result, "flags");
  const active = row?.base ?? 0;
  const flagged = row ? active - cellOf(row, "COMPLIANT").count : 0;
  return (
    <StatCard
      title="Schools flagged"
      value={formatCount(flagged)}
      hint={`Of ${formatCount(active)} active schools`}
      icon={ShieldAlert}
      tone={flagged > 0 ? "amber" : "neutral"}
      decor="clock"
      action={{ label: "Non-compliance", href: DISTRICT_ROUTES.summary("compliance") }}
    />
  );
}

async function AttentionRail({
  user,
  adminScope,
  scope,
}: {
  user: Pick<User, "id">;
  adminScope: AdminScope;
  scope: SummaryScope;
}) {
  const [notifications, compliance] = await Promise.all([
    getDistrictNotifications(user, adminScope),
    loadCompliance(scope),
  ]);
  return (
    <SchoolAttentionPanel
      items={buildDistrictAttention({
        notifications,
        complianceLists: compliance.lists,
        complianceHref: DISTRICT_ROUTES.summary("compliance"),
      })}
    />
  );
}

function districtsOf(scope: AdminScope, schools: { district: string | null }[]): (string | null)[] {
  if (scope.kind === "districts") return [...scope.districts];
  const names = [...new Set(schools.map((s) => s.district))];
  return [...names.filter((d): d is string => d !== null).sort(), ...(names.includes(null) ? [null] : [])];
}

function schoolsLabel(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "school" : "schools"}`;
}

function heroMeta(scope: AdminScope, districts: (string | null)[], schoolCount: number): string {
  if (scope.kind === "districts" && scope.districts.length === 0) return "No districts assigned yet";
  const where =
    scope.kind === "division"
      ? "Whole division"
      : districts.length === 1
        ? (districts[0] ?? "No district")
        : `${districts.length} districts`;
  return `${where} · ${schoolsLabel(schoolCount)}`;
}

export default async function DistrictOverviewPage() {
  const { user, scope } = await requireAdminScope();
  const schools = await resolveScopeSchools(scope, await isDemoVisible());
  const summaryScope = resolveSummaryScope(scope, {});
  const todayKey = formatLocalDateKey(schoolToday());
  const month = monthKeyOf(todayKey);
  const districts = districtsOf(scope, schools);
  const noAssignments = scope.kind === "districts" && scope.districts.length === 0;

  const districtCards: DistrictCard[] = districts.map((district) => {
    const inDistrict = schools.filter((s) => s.district === district);
    return {
      district,
      schoolCount: inDistrict.length,
      activeCount: inDistrict.filter((s) => s.isActive).length,
    };
  });

  const quote = pickQuote();
  // The calendar shows the next quote in the list, so it never repeats the hero.
  const calendarQuote =
    DASHBOARD_QUOTES[(DASHBOARD_QUOTES.indexOf(quote) + 1) % DASHBOARD_QUOTES.length];
  const firstName = user.firstName.trim() || user.fullName.trim().split(/\s+/)[0] || "there";

  return (
    <AppShell
      title="District Overview"
      role={user.role}
      userName={user.fullName || user.email}
      hideTitle
    >
      <div className="mb-6">
        {/* District admins have no profile gender, so they get the same
            default art a Super Admin sees on the School Head dashboard. */}
        <SchoolHeadGreetingHero
          firstName={firstName}
          todayKey={todayKey}
          bannerSrc={teacherBannerSrc(null)}
          quote={quote}
          subtitle={
            scope.kind === "division"
              ? "Here's how the division's schools are doing."
              : "Here's how your schools are doing today."
          }
          meta={heroMeta(scope, districts, schools.length)}
        />
      </div>

      {noAssignments ? (
        <NoDistrictsState />
      ) : (
        <div className="flex min-w-0 flex-col gap-6">
          {/* Desktop: the tiles rise into the hero's soft lower edge, as on the
              School Head dashboard. */}
          <div className="relative z-10 grid grid-cols-1 gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <section aria-labelledby="district-headline" className="min-w-0">
                <h2 id="district-headline" className="sr-only">
                  Headline figures
                </h2>
                <StatCardRow>
                  <Suspense fallback={<DistrictStatSkeleton />}>
                    <LearnersTile scope={summaryScope} />
                  </Suspense>
                  <Suspense fallback={<DistrictStatSkeleton />}>
                    <AralLearnersTile scope={summaryScope} month={month} />
                  </Suspense>
                  <Suspense fallback={<DistrictStatSkeleton />}>
                    <AttendanceTile scope={summaryScope} month={month} />
                  </Suspense>
                  <Suspense fallback={<DistrictStatSkeleton />}>
                    <ComplianceTile scope={summaryScope} />
                  </Suspense>
                </StatCardRow>
              </section>

              <DistrictsPanel
                title={scope.kind === "districts" ? "Your districts" : "Districts"}
                districts={districtCards}
                totalSchools={schools.length}
              />
            </div>

            <aside
              aria-label="Calendar and alerts"
              className="flex min-w-0 flex-col gap-4 xl:relative xl:z-10 xl:-mt-4"
            >
              <div className="hidden xl:block">
                <CalendarCard todayKey={todayKey} quote={calendarQuote} />
              </div>
              <Suspense fallback={<DistrictAttentionSkeleton />}>
                <AttentionRail user={user} adminScope={scope} scope={summaryScope} />
              </Suspense>
            </aside>
          </div>

          <section aria-labelledby="district-summaries" className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
              >
                <BarChart3 className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 id="district-summaries" className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                  Summaries
                </h2>
                <p className="text-sm text-muted-foreground">
                  Overall, by district or by school, ready to export.
                </p>
              </div>
            </div>
            <SummaryFacetIndex basePath="/district/summary" />
          </section>
        </div>
      )}
    </AppShell>
  );
}
