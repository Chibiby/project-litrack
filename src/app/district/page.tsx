import { Suspense } from "react";
import Link from "next/link";
import { BookOpenCheck, Building2, CalendarDays, ShieldAlert, Users } from "lucide-react";
import { requireAdminScope } from "@/lib/auth/district-scope";
import type { AdminScope, SummaryScope } from "@/lib/auth/admin-scope";
import { resolveSummaryScope } from "@/lib/auth/admin-scope";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { SUMMARY_FACETS } from "@/lib/summary/facets";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { monthKeyOf, monthLabel } from "@/lib/summary/shape/months";
import { cellOf, NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type { FacetResult, SummaryGroup } from "@/lib/summary/types";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryFacetIndex } from "@/components/summary/summary-facet-index";
import { formatCount, formatPct } from "@/components/summary/summary-format";

export const dynamic = "force-dynamic";

/** The single "All grades" row of an overall-level section. */
function overallRow(result: FacetResult, sectionId: string): SummaryGroup | null {
  const section = result.sections.find((s) => s.id === sectionId);
  return section?.table.groups.find((g) => !g.gradeType) ?? null;
}

function TileSkeleton() {
  return (
    <Surface className="p-5" aria-hidden>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-1.5 h-3 w-28" />
    </Surface>
  );
}

async function LearnersTile({ scope }: { scope: SummaryScope }) {
  const result = await SUMMARY_FACETS.learners.load(scope, { level: "overall" });
  const total = overallRow(result, "gender")?.base ?? 0;
  return (
    <MetricCard
      title="Learners"
      value={formatCount(total)}
      icon={Users}
      hint="Enrolled in the active school year"
      href={DISTRICT_ROUTES.summary("learners")}
    />
  );
}

async function AralLearnersTile({ scope, month }: { scope: SummaryScope; month: string }) {
  const result = await SUMMARY_FACETS["reading-behavior"].load(scope, { level: "overall", month });
  const total = overallRow(result, "wordRecognition")?.base ?? 0;
  return (
    <MetricCard
      title="ARAL learners"
      value={formatCount(total)}
      icon={BookOpenCheck}
      tone="violet"
      hint="In the ARAL reading program"
      href={`${DISTRICT_ROUTES.summary("reading-behavior")}?month=${month}`}
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
    <MetricCard
      title="Attendance this month"
      value={formatPct(rate)}
      icon={CalendarDays}
      tone="violet"
      hint={`ARAL learners, ${monthLabel(month)}`}
      href={`${DISTRICT_ROUTES.summary("attendance")}?from=${month}&to=${month}`}
    />
  );
}

async function ComplianceTile({ scope }: { scope: SummaryScope }) {
  const result = await SUMMARY_FACETS.compliance.load(scope, { level: "overall" });
  const row = overallRow(result, "flags");
  const active = row?.base ?? 0;
  const flagged = row ? active - cellOf(row, "COMPLIANT").count : 0;
  return (
    <MetricCard
      title="Schools flagged"
      value={formatCount(flagged)}
      icon={ShieldAlert}
      tone={flagged > 0 ? "amber" : "default"}
      hint={`Of ${formatCount(active)} active schools`}
      href={DISTRICT_ROUTES.summary("compliance")}
    />
  );
}

function districtsOf(scope: AdminScope, schools: { district: string | null }[]): (string | null)[] {
  if (scope.kind === "districts") return [...scope.districts];
  const names = [...new Set(schools.map((s) => s.district))];
  return [...names.filter((d): d is string => d !== null).sort(), ...(names.includes(null) ? [null] : [])];
}

export default async function DistrictOverviewPage() {
  const { user, scope } = await requireAdminScope();
  const schools = await resolveScopeSchools(scope, await isDemoVisible());
  const summaryScope = resolveSummaryScope(scope, {});
  const month = monthKeyOf(formatLocalDateKey(schoolToday()));
  const districts = districtsOf(scope, schools);
  const noAssignments = scope.kind === "districts" && scope.districts.length === 0;

  const subtitle =
    scope.kind === "division"
      ? "The whole division"
      : `${districts.length === 1 ? "District" : "Districts"}: ${districts.join(", ") || "none assigned"}`;

  return (
    <AppShell
      title="District Overview"
      subtitle={subtitle}
      role={user.role}
      userName={user.fullName || user.email}
    >
      {noAssignments ? (
        <EmptyState
          icon={Building2}
          title="No districts assigned yet"
          description="Your account has no district assigned, so there are no schools to show. Ask the division office to assign your districts."
        />
      ) : (
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="district-headline" className="min-w-0">
            <h2 id="district-headline" className="sr-only">
              Headline figures
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Suspense fallback={<TileSkeleton />}>
                <LearnersTile scope={summaryScope} />
              </Suspense>
              <Suspense fallback={<TileSkeleton />}>
                <AralLearnersTile scope={summaryScope} month={month} />
              </Suspense>
              <Suspense fallback={<TileSkeleton />}>
                <AttendanceTile scope={summaryScope} month={month} />
              </Suspense>
              <Suspense fallback={<TileSkeleton />}>
                <ComplianceTile scope={summaryScope} />
              </Suspense>
            </div>
          </section>

          <section aria-labelledby="district-list" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="district-list" className="text-base font-semibold tracking-tight">
                {scope.kind === "districts" ? "Your districts" : "Districts"}
              </h2>
              <Link
                href={DISTRICT_ROUTES.schools}
                prefetch={true}
                className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:min-h-0"
              >
                {formatCount(schools.length)} {schools.length === 1 ? "school" : "schools"} in all
              </Link>
            </div>
            {districts.length === 0 ? (
              <EmptyState icon={Building2} title="No schools yet" description="No schools are recorded in your scope." />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {districts.map((district) => {
                  const count = schools.filter((s) => s.district === district).length;
                  const label = district ?? NO_DISTRICT_LABEL;
                  return (
                    <li key={label} className="min-w-0">
                      <Surface className="flex h-full items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{label}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatCount(count)} {count === 1 ? "school" : "schools"}
                          </p>
                        </div>
                        {district !== null ? (
                          <Link
                            href={`${DISTRICT_ROUTES.summary("learners")}?district=${encodeURIComponent(district)}`}
                            prefetch={true}
                            className="inline-flex min-h-10 shrink-0 items-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:min-h-0"
                            aria-label={`Summary for ${district}`}
                          >
                            Summary
                          </Link>
                        ) : null}
                      </Surface>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="district-summaries" className="min-w-0">
            <h2 id="district-summaries" className="mb-3 text-base font-semibold tracking-tight">
              Summaries
            </h2>
            <SummaryFacetIndex basePath="/district/summary" />
          </section>
        </div>
      )}
    </AppShell>
  );
}
