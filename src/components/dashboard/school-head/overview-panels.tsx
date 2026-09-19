import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { percentOf } from "@/components/ui/segmented-bar";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The School Head dashboard's coverage donuts (`docs/school-head-ui-rework.md`
 * section 3.5), plus the school-wide weekly attendance donut approved in
 * section 0a decision 4. Same donut / legend / tip / pill anatomy as
 * `src/components/dashboard/teacher/overview-panels.tsx`; its `Donut`,
 * `PanelShell` and `Legend` are module-private there, so they are copied
 * below rather than exported and imported — exporting four internal helpers
 * to serve one new caller would freeze the teacher panel's internals as a
 * public API for no gain.
 *
 * Every share is printed as a count and a percentage (or the ip metrics'
 * own em-dash) beside a labelled dot, so no state is conveyed by colour
 * alone, and every donut is honest at a zero denominator: `percentOf`
 * returns 0 rather than NaN, and the IP panel's `ipPercent` already arrives
 * pre-formatted as "—" at zero from `shapeSchoolIpMetrics`.
 */

type Segment = {
  label: string;
  value: number;
  /** SVG stroke colour class, e.g. `stroke-emerald-500`. */
  stroke: string;
  dot: string;
  /** Hidden in the phone legend. */
  desktopOnly?: boolean;
};

function Donut({
  segments,
  total,
  rateLabel,
  caption,
  track,
}: {
  segments: Segment[];
  total: number;
  /** Pre-formatted, e.g. "42%" or "—" — callers decide how to render zero. */
  rateLabel: string;
  caption: string;
  track: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative mx-auto size-32 shrink-0 sm:size-36">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="11" className={track} />
        {total > 0
          ? segments.map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.label}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  strokeWidth="11"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  className={s.stroke}
                />
              );
              offset += len;
              return s.value > 0 ? el : null;
            })
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-extrabold tabular-nums text-foreground sm:text-3xl">
          {rateLabel}
        </span>
        <span className="text-[11px] text-muted-foreground sm:text-xs">{caption}</span>
      </div>
    </div>
  );
}

function PanelShell({
  title,
  period,
  subtitle,
  icon: Icon,
  iconTile,
  children,
  action,
}: {
  title: string;
  period: string;
  subtitle: string;
  icon: LucideIcon;
  iconTile: string;
  children: React.ReactNode;
  action: { label: string; href: string };
}) {
  return (
    <Surface as="section" className="relative flex min-w-0 flex-col rounded-2xl">
      <div className="flex items-start gap-3 px-3 pt-4 sm:px-5 sm:pt-5">
        <span
          aria-hidden
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11", iconTile)}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {title} <span className="hidden font-normal text-muted-foreground lg:inline">({period})</span>
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            <span className="lg:hidden">{period}</span>
            <span className="hidden lg:inline">{subtitle}</span>
          </p>
        </div>
        <span className="hidden shrink-0 rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium text-foreground lg:inline-block">
          {period}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-violet-600 lg:hidden" />
      </div>

      <div className="flex flex-1 flex-col justify-center px-3 pt-4 sm:px-5">{children}</div>

      <div className="flex px-3 pb-4 pt-4 sm:px-5 sm:pb-5 lg:justify-end">
        <PrefetchLink
          href={action.href}
          prefetch
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-100 px-3 py-2.5 text-center text-xs font-medium text-violet-700 transition-colors hover:bg-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm lg:w-auto lg:rounded-full lg:px-4 lg:py-2 dark:bg-violet-900/40 dark:text-violet-200"
        >
          {action.label}
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        </PrefetchLink>
      </div>
    </Surface>
  );
}

function Legend({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <>
      {/* Desktop: one row per state with count and share. */}
      <ul className="hidden min-w-0 flex-1 space-y-3 lg:block">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-sm">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", s.dot)} />
            <span className="flex-1 text-foreground">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {s.value} ({percentOf(s.value, total)}%)
            </span>
          </li>
        ))}
      </ul>
      {/* Phone: compact wrap of label and count. */}
      <ul className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 lg:hidden">
        {segments
          .filter((s) => !s.desktopOnly)
          .map((s) => (
            <li key={s.label} className="flex items-center gap-1 text-xs">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", s.dot)} />
              <span className="text-foreground">{s.label}</span>
              <span className="tabular-nums text-muted-foreground">{s.value}</span>
            </li>
          ))}
      </ul>
    </>
  );
}

export function AralCoveragePanel({
  aralCount,
  learnerCount,
  href,
}: {
  aralCount: number;
  learnerCount: number;
  href: string;
}) {
  const segments: Segment[] = [
    { label: "In ARAL", value: aralCount, stroke: "stroke-emerald-500", dot: "bg-emerald-500" },
    {
      label: "Not enrolled",
      value: Math.max(learnerCount - aralCount, 0),
      stroke: "stroke-slate-300 dark:stroke-slate-600",
      dot: "bg-muted-foreground/50",
    },
  ];
  const rate = percentOf(aralCount, learnerCount);

  return (
    <PanelShell
      title="ARAL Coverage"
      period="This school year"
      subtitle="Learners currently in the ARAL program"
      icon={Sparkles}
      iconTile="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
      action={{ label: "Designate ARAL teachers", href }}
    >
      <div className="lg:flex lg:items-center lg:gap-6">
        <Donut
          segments={segments}
          total={learnerCount}
          rateLabel={`${rate}%`}
          caption="ARAL coverage"
          track="stroke-violet-100 dark:stroke-violet-950/60"
        />
        <Legend segments={segments} total={learnerCount} />
      </div>
      {learnerCount === 0 ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          ARAL coverage appears once learners are enrolled.
        </p>
      ) : null}
    </PanelShell>
  );
}

export function IpCoveragePanel({
  ipLearners,
  totalLearners,
  ipPercent,
  href,
}: {
  ipLearners: number;
  totalLearners: number;
  ipPercent: string;
  href: string;
}) {
  const segments: Segment[] = [
    { label: "IP", value: ipLearners, stroke: "stroke-amber-500", dot: "bg-amber-500" },
    {
      label: "Non-IP",
      value: Math.max(totalLearners - ipLearners, 0),
      stroke: "stroke-slate-300 dark:stroke-slate-600",
      dot: "bg-muted-foreground/50",
    },
  ];

  return (
    <PanelShell
      title="IP Learners"
      period="Active enrolment"
      subtitle="Indigenous People learners currently enrolled"
      icon={Users}
      iconTile="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
      action={{ label: "View IP learners", href }}
    >
      <div className="lg:flex lg:items-center lg:gap-6">
        <Donut
          segments={segments}
          total={totalLearners}
          rateLabel={ipPercent}
          caption="of enrolled"
          track="stroke-amber-100 dark:stroke-amber-950/60"
        />
        <Legend segments={segments} total={totalLearners} />
      </div>
      {totalLearners === 0 ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          Appears once learners are enrolled in the active school year.
        </p>
      ) : null}
    </PanelShell>
  );
}

export type SchoolAttendanceMix = {
  present: number;
  absent: number;
  late: number;
  excused: number;
  noClass: number;
  totalMarks: number;
  denominator: number;
};

/**
 * The school-wide weekly attendance donut (section 0a decision 4), fed by
 * `getSchoolHeadAttendanceMix`. That aggregate only has rows for ARAL
 * learners — LITRACK records daily attendance for the ARAL program only, the
 * same scope the teacher side's own attendance panel documents — so this is
 * "school-wide" from the head's vantage point (every section, not one
 * teacher's), not literally every learner.
 */
export function SchoolAttendancePanel({
  mix,
  href,
}: {
  mix: SchoolAttendanceMix;
  href: string;
}) {
  const segments: Segment[] = [
    { label: "Present", value: mix.present, stroke: "stroke-emerald-500", dot: "bg-emerald-500" },
    { label: "Late", value: mix.late, stroke: "stroke-amber-500", dot: "bg-amber-500" },
    { label: "Absent", value: mix.absent, stroke: "stroke-rose-500", dot: "bg-rose-500" },
    { label: "Excused", value: mix.excused, stroke: "stroke-sky-500", dot: "bg-sky-500", desktopOnly: true },
    {
      label: "Unmarked",
      value: mix.noClass,
      stroke: "stroke-slate-300 dark:stroke-slate-600",
      dot: "bg-muted-foreground/50",
    },
  ];
  const rate = percentOf(mix.present, mix.denominator);

  return (
    <PanelShell
      title="Weekly Attendance"
      period="This week"
      subtitle="ARAL attendance marks across every section"
      icon={CalendarCheck}
      iconTile="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
      action={{ label: "View ARAL program", href }}
    >
      <div className="lg:flex lg:items-center lg:gap-6">
        <Donut
          segments={segments}
          total={mix.denominator}
          rateLabel={`${rate}%`}
          caption="Present rate"
          track="stroke-slate-100 dark:stroke-slate-800"
        />
        <Legend segments={segments} total={mix.denominator} />
      </div>
      {mix.denominator === 0 ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          Attendance is recorded for ARAL learners. None have been marked yet this week.
        </p>
      ) : null}
    </PanelShell>
  );
}
