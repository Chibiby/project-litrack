import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleX,
  Clock,
  KeyRound,
  Layers,
  LogIn,
  MapPinned,
  School,
  Shuffle,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";
import { Surface } from "@/components/ui/surface";
import type {
  DistrictAdminsSummary,
  SchoolHeadsSummary,
  SchoolsSummary,
  TeachersSummary,
} from "@/lib/admin/management";

const n = (value: number) => value.toLocaleString();

/** The card grid plus a one-line caption naming what the figures cover. */
export function SummaryGrid({
  scope,
  label,
  children,
}: {
  scope: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Figures for: <span className="font-medium text-foreground">{scope}</span>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}

export function SummaryUnavailable({ what }: { what: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      The {what} figures could not be loaded right now. The list below still works.
    </p>
  );
}

const card = { inlineOnPhone: true, denseOnPhone: true } as const;

export function TeachersSummaryCards({ summary, scope }: { summary: TeachersSummary; scope: string }) {
  return (
    <SummaryGrid scope={scope} label="Teacher overview">
      {/* Same figure and words as the dashboard's Teachers card. */}
      <StatCard title="Active teachers" value={n(summary.activeTeachers)} hint="Active teaching accounts" icon={CircleCheck} tone="emerald" {...card} />
      <StatCard
        title="Pending approval"
        value={n(summary.pendingApproval)}
        hint="Waiting on their School Head"
        icon={Clock}
        tone={summary.pendingApproval > 0 ? "amber" : "neutral"}
        {...card}
      />
      <StatCard title="Inactive" value={n(summary.inactive)} hint="Approved, switched off" icon={CircleX} tone="neutral" {...card} />
      <StatCard title="Multi-advisory" value={n(summary.multiAdvisory)} hint="Advise more than one section" icon={Layers} tone="primary" {...card} />
      <StatCard title="Floating" value={n(summary.floating)} hint="No advisory section" icon={Shuffle} tone="neutral" {...card} />
      <StatCard title="All accounts" value={n(summary.total)} hint="Includes pending and switched off" icon={Users} tone="primary" {...card} />
    </SummaryGrid>
  );
}

export function SchoolHeadsSummaryCards({
  summary,
  scope,
}: {
  summary: SchoolHeadsSummary;
  scope: string;
}) {
  return (
    <SummaryGrid scope={scope} label="School Head overview">
      <StatCard title="School Heads" value={n(summary.total)} hint="Sign-in accounts" icon={Users} tone="primary" {...card} />
      <StatCard title="Active" value={n(summary.active)} hint="Can sign in" icon={CircleCheck} tone="emerald" {...card} />
      <StatCard title="Inactive" value={n(summary.inactive)} hint="Switched off" icon={CircleX} tone="neutral" {...card} />
      <StatCard
        title="On a reset password"
        value={n(summary.mustChangePassword)}
        hint="Must choose a new one"
        icon={KeyRound}
        tone={summary.mustChangePassword > 0 ? "amber" : "neutral"}
        {...card}
      />
      <StatCard title="Never signed in" value={n(summary.neverSignedIn)} hint="No sign-in recorded" icon={LogIn} tone="neutral" {...card} />
      <StatCard
        title="Schools without a head"
        value={n(summary.schoolsWithoutHead)}
        hint="No School Head account"
        icon={School}
        tone={summary.schoolsWithoutHead > 0 ? "amber" : "neutral"}
        {...card}
      />
    </SummaryGrid>
  );
}

export function DistrictAdminsSummaryCards({
  summary,
  scope,
}: {
  summary: DistrictAdminsSummary;
  scope: string;
}) {
  const hidden = summary.districtsWithoutAdmin - summary.uncoveredDistricts.length;
  return (
    <div className="space-y-3">
      <SummaryGrid scope={scope} label="District admin overview">
        <StatCard title="District admins" value={n(summary.total)} hint="Every live account" icon={Users} tone="primary" {...card} />
        <StatCard title="Active" value={n(summary.active)} hint="Can sign in" icon={CircleCheck} tone="emerald" {...card} />
        <StatCard title="Inactive" value={n(summary.inactive)} hint="Switched off" icon={CircleX} tone="neutral" {...card} />
        <StatCard
          title="Districts covered"
          value={`${n(summary.districtsCovered)} of ${n(summary.districtsTotal)}`}
          hint="Have an active district admin"
          icon={MapPinned}
          tone="emerald"
          {...card}
        />
        <StatCard
          title="Without an admin"
          value={n(summary.districtsWithoutAdmin)}
          hint="Districts nobody oversees"
          icon={MapPinned}
          tone={summary.districtsWithoutAdmin > 0 ? "amber" : "neutral"}
          {...card}
        />
      </SummaryGrid>
      {summary.uncoveredDistricts.length > 0 ? (
        <Surface as="section" aria-label="Districts without a district admin" className="rounded-2xl p-3 sm:p-4">
          <h2 className="text-sm font-semibold">Districts without an active district admin</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {summary.uncoveredDistricts.map((district) => (
              <li
                key={district}
                className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
              >
                {district}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              and {n(hidden)} more. Filter by district to check one.
            </p>
          ) : null}
        </Surface>
      ) : null}
    </div>
  );
}

export function SchoolsSummaryCards({ summary, scope }: { summary: SchoolsSummary; scope: string }) {
  return (
    <SummaryGrid scope={scope} label="School overview">
      <StatCard title="Schools" value={n(summary.total)} hint="Registered, not removed" icon={School} tone="primary" {...card} />
      <StatCard title="Active" value={n(summary.active)} hint="Open for sign-in" icon={CircleCheck} tone="emerald" {...card} />
      <StatCard title="Inactive" value={n(summary.inactive)} hint="Switched off" icon={CircleX} tone="neutral" {...card} />
      <StatCard title="Districts" value={n(summary.districtCount)} hint="With at least one school" icon={MapPinned} tone="primary" {...card} />
      <StatCard
        title="No district"
        value={n(summary.noDistrict)}
        hint="District not recorded"
        icon={MapPinned}
        tone={summary.noDistrict > 0 ? "amber" : "neutral"}
        {...card}
      />
    </SummaryGrid>
  );
}
