import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { percentOf } from "@/components/ui/segmented-bar";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { TeacherOverview } from "@/lib/dashboard/teacher-overview";

/**
 * The two v2 overview panels (mockup images 3 and 4): tinted icon tile and
 * period heading, a donut with the headline rate, a legend with count and
 * share, and a pill into the entry screen. From lg up the donut sits above a
 * grid of state tiles, so the panel fills the height the calendar rail gives
 * the row instead of floating in empty space.
 *
 * Every share is printed as a count and a percentage beside a labelled dot,
 * so no state is conveyed by colour alone. The period chip is a static label,
 * not a picker: LITRACK has no historical dashboard to switch to.
 */

type Segment = {
  label: string;
  value: number;
  /** SVG stroke colour class, e.g. `stroke-success-500`. */
  stroke: string;
  dot: string;
  /** Hidden in the phone legend (image 4 drops Excused). */
  desktopOnly?: boolean;
};

function Donut({
  segments,
  total,
  rate,
  caption,
  track,
}: {
  segments: Segment[];
  total: number;
  rate: number;
  caption: string;
  track: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative mx-auto size-32 shrink-0 sm:size-36 lg:size-40 2xl:size-44">
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
        <span className="text-2xl font-extrabold tabular-nums text-foreground sm:text-3xl lg:text-4xl">
          {rate}%
        </span>
        <span className="text-xs text-muted-foreground">{caption}</span>
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
    <Surface as="section" className="relative flex min-w-0 flex-col rounded-lg">
      <div className="flex items-start gap-3 px-3 pt-4 sm:px-5 sm:pt-5">
        <span
          aria-hidden
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-md sm:size-11", iconTile)}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {title}
          </h2>
          <p className="truncate text-xs text-muted-foreground sm:text-sm" title={subtitle}>
            {/* Narrow panels (phone up to xl) show the period here instead of
                the chip, so the title never has to share its line. */}
            <span className="2xl:hidden">{period}</span>
            <span className="hidden 2xl:inline">{subtitle}</span>
          </p>
        </div>
        <span className="hidden shrink-0 rounded-md border border-border/80 px-3 py-1.5 text-xs font-medium text-foreground 2xl:inline-block">
          {period}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-aral-600 lg:hidden" />
      </div>

      <div className="flex flex-1 flex-col justify-center px-3 pt-4 sm:px-5">{children}</div>

      <div className="flex px-3 pb-4 pt-4 sm:px-5 sm:pb-5 lg:justify-end">
        <PrefetchLink
          href={action.href}
          prefetch
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-aral-100 px-3 py-2.5 text-center text-xs font-medium text-aral-strong transition-colors hover:bg-aral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm lg:w-auto lg:rounded-full lg:px-4 lg:py-2 dark:bg-aral-900/40"
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
      {/* Desktop: one tile per state, count large and share beside it. */}
      <ul className="hidden w-full gap-2 lg:grid lg:grid-cols-2">
        {segments.map((s) => (
          <li
            key={s.label}
            className="rounded-lg border border-border/60 bg-background/50 px-3 py-2.5 dark:bg-foreground/[0.03]"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", s.dot)} />
              {s.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums text-foreground">{s.value}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{percentOf(s.value, total)}%</span>
            </div>
          </li>
        ))}
      </ul>
      {/* Phone: compact wrap of label and count (image 4). */}
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


export function AttendanceOverviewPanel({
  data,
  href,
}: {
  data: TeacherOverview;
  href: string;
}) {
  const a = data.attendance;
  // LITRACK records LATE as its own status, so the ring carries four states.
  // Only recorded marks count: a day nobody marked is not in the total.
  const segments: Segment[] = [
    { label: "Present", value: a.present, stroke: "stroke-success-500", dot: "bg-success-500" },
    { label: "Late", value: a.late, stroke: "stroke-warning-500", dot: "bg-warning-500" },
    { label: "Absent", value: a.absent, stroke: "stroke-danger-500", dot: "bg-danger-500" },
    { label: "Excused", value: a.excused, stroke: "stroke-info-500", dot: "bg-info-500", desktopOnly: true },
  ];
  const total = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <PanelShell
      title="Attendance Overview"
      period="This Week"
      subtitle="Total attendance marks across all learners"
      icon={Users}
      iconTile="icon-glass text-aral-strong"
      action={{ label: "View weekly attendance", href }}
    >
      <div className="lg:flex lg:flex-col lg:items-center lg:gap-6">
        <Donut
          segments={segments}
          total={total}
          rate={a.presentRate}
          caption="Present rate"
          track="stroke-slate-100 dark:stroke-slate-800"
        />
        <Legend segments={segments} total={total} />
      </div>
      {data.aralLearners === 0 ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          Attendance is recorded for ARAL learners. None are designated in your grades yet.
        </p>
      ) : null}
    </PanelShell>
  );
}

export function ReadingOverviewPanel({
  data,
  href,
}: {
  data: TeacherOverview;
  href: string;
}) {
  const r = data.reading;
  const segments: Segment[] = [
    { label: "Completed", value: r.completed, stroke: "stroke-success-500", dot: "bg-success-500" },
    { label: "Pending", value: r.pending, stroke: "stroke-warning-400", dot: "bg-warning-400" },
  ];
  const total = data.aralLearners;

  return (
    <PanelShell
      title="Reading Level Overview"
      period="This Month"
      subtitle="Reading records submitted by learners"
      icon={BookOpen}
      iconTile="icon-glass text-blue-700 dark:text-blue-200"
      action={{ label: "Go to Monthly Reading Level", href }}
    >
      <div className="lg:flex lg:flex-col lg:items-center lg:gap-6">
        <Donut
          segments={segments}
          total={total}
          rate={r.completionRate}
          caption="Completion rate"
          track="stroke-warning-100 dark:stroke-warning-950/60"
        />
        <Legend segments={segments} total={total} />
      </div>
      {total === 0 ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          Reading levels are assessed monthly for ARAL learners. None are designated in your grades yet.
        </p>
      ) : null}
    </PanelShell>
  );
}
