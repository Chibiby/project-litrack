import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { SegmentedBar, percentOf, type BarSegment } from "@/components/ui/segmented-bar";
import { cn } from "@/lib/utils";
import { ArrowRight, BookOpen, CalendarDays } from "lucide-react";
import type { TeacherOverview } from "@/lib/dashboard/teacher-overview";

/**
 * The two overview panels, built to the approved design: a period-scoped
 * heading, one headline figure, a tinted rate badge, a segmented bar with a
 * dotted legend, and a link into the entry screen.
 *
 * Every share is rendered as a count *and* a percentage, and each segment
 * carries a labelled dot, so no state on this page is ever conveyed by colour
 * alone.
 */

function PanelShell({
  title,
  period,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  period: string;
  icon: typeof CalendarDays;
  children: React.ReactNode;
  action: { label: string; href: string };
}) {
  return (
    <Surface as="section" className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {title}{" "}
          <span className="font-normal text-muted-foreground">({period})</span>
        </h2>
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </div>

      <div className="flex-1 px-5 pt-4">{children}</div>

      <div className="px-5 pb-5 pt-4">
        <PrefetchLink
          href={action.href}
          prefetch
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-violet-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card dark:text-violet-300"
        >
          {action.label}
          <ArrowRight aria-hidden className="size-4" />
        </PrefetchLink>
      </div>
    </Surface>
  );
}

function Headline({
  value,
  label,
  badgeValue,
  badgeLabel,
  badgeTone,
}: {
  value: number;
  label: string;
  badgeValue: string;
  badgeLabel: string;
  badgeTone: "emerald" | "violet";
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-4xl font-bold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </div>
      <div
        className={cn(
          "shrink-0 rounded-lg px-3 py-2 text-center",
          badgeTone === "emerald"
            ? "bg-emerald-100 dark:bg-emerald-900/30"
            : "bg-violet-100 dark:bg-violet-900/40"
        )}
      >
        <p
          className={cn(
            "text-sm font-bold tabular-nums",
            badgeTone === "emerald"
              ? "text-emerald-800 dark:text-emerald-200"
              : "text-violet-800 dark:text-violet-200"
          )}
        >
          {badgeValue}
        </p>
        <p
          className={cn(
            "text-[11px] leading-tight",
            badgeTone === "emerald"
              ? "text-emerald-700/80 dark:text-emerald-300/80"
              : "text-violet-700/80 dark:text-violet-300/80"
          )}
        >
          {badgeLabel}
        </p>
      </div>
    </div>
  );
}

function Legend({ segments, total }: { segments: BarSegment[]; total: number }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", s.dotClassName)}
          />
          <span className="font-medium text-foreground">{s.label}</span>
          <span className="tabular-nums text-muted-foreground">
            {s.value} ({percentOf(s.value, total)}%)
          </span>
        </li>
      ))}
    </ul>
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
  // LITRACK records LATE as its own status, so the bar carries five states
  // rather than the four a simpler roster would need.
  const segments: BarSegment[] = [
    { label: "Present", value: a.present, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
    { label: "Late", value: a.late, className: "bg-amber-500", dotClassName: "bg-amber-500" },
    { label: "Absent", value: a.absent, className: "bg-rose-500", dotClassName: "bg-rose-500" },
    { label: "Excused", value: a.excused, className: "bg-sky-500", dotClassName: "bg-sky-500" },
    { label: "Unmarked", value: a.noClass, className: "bg-muted-foreground/30", dotClassName: "bg-muted-foreground/40" },
  ];
  const total = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <PanelShell
      title="Attendance Overview"
      period="This Week"
      icon={CalendarDays}
      action={{ label: "View weekly attendance", href }}
    >
      <Headline
        value={a.totalMarks}
        label="Total attendance marks"
        badgeValue={`${a.presentRate}%`}
        badgeLabel="Present rate"
        badgeTone="emerald"
      />
      {total > 0 ? (
        <>
          <SegmentedBar segments={segments} className="mt-4 h-2.5" />
          <Legend segments={segments} total={total} />
        </>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {data.aralLearners === 0
            ? "Attendance is recorded for ARAL learners. None are designated in your grades yet."
            : "No attendance has been marked this week. The weekly grid opens on Monday."}
        </p>
      )}
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
  const segments: BarSegment[] = [
    { label: "Completed", value: r.completed, className: "bg-emerald-500", dotClassName: "bg-emerald-500" },
    { label: "Pending", value: r.pending, className: "bg-amber-500", dotClassName: "bg-amber-500" },
  ];
  const total = data.aralLearners;

  return (
    <PanelShell
      title="Reading Level Overview"
      period="This Month"
      icon={BookOpen}
      action={{ label: "Go to Monthly Reading Level", href }}
    >
      <Headline
        value={r.submitted}
        label="Reading records submitted"
        badgeValue={`${r.completionRate}%`}
        badgeLabel="Completion rate"
        badgeTone="violet"
      />
      {total > 0 ? (
        <>
          <SegmentedBar segments={segments} className="mt-4 h-2.5" />
          <Legend segments={segments} total={total} />
        </>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Reading levels are assessed monthly for ARAL learners. None are
          designated in your grades yet.
        </p>
      )}
    </PanelShell>
  );
}
