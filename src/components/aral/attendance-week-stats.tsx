"use client";

import { CalendarDays, CheckCircle2, Percent, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeekStats } from "@/lib/attendance/week-stats";

type CardTone = "sky" | "emerald" | "violet" | "amber";

const TONE_CLASSES: Record<CardTone, { badge: string; icon: string }> = {
  sky: {
    badge: "bg-sky-100 dark:bg-sky-900/40",
    icon: "text-sky-700 dark:text-sky-300",
  },
  emerald: {
    badge: "bg-emerald-100 dark:bg-emerald-900/40",
    icon: "text-emerald-700 dark:text-emerald-300",
  },
  violet: {
    badge: "bg-violet-100 dark:bg-violet-900/40",
    icon: "text-violet-700 dark:text-violet-300",
  },
  amber: {
    badge: "bg-amber-100 dark:bg-amber-900/40",
    icon: "text-amber-700 dark:text-amber-300",
  },
};

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  tone: CardTone;
  label: string;
  value: string;
  sub: string;
}) {
  const tones = TONE_CLASSES[tone];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-card">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          tones.badge
        )}
        aria-hidden
      >
        <Icon className={cn("size-5", tones.icon)} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

/**
 * The four summary cards above the week-status banner, computed from the week
 * currently loaded in the grid. See `computeWeekStats` for the math.
 */
export function AttendanceWeekStats({ stats }: { stats: WeekStats }) {
  const completionPct =
    stats.schoolDays > 0
      ? Math.round((stats.daysRecorded / stats.schoolDays) * 100)
      : 0;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Users}
        tone="sky"
        label="Total Learners"
        value={String(stats.learnerCount)}
        sub="All enrolled learners"
      />
      <StatCard
        icon={CheckCircle2}
        tone="emerald"
        label="Present Marks"
        value={String(stats.presentMarks)}
        sub={`out of ${stats.possible} possible days`}
      />
      <StatCard
        icon={Percent}
        tone="violet"
        label="Attendance Rate"
        value={`${stats.ratePct}%`}
        sub="This week's rate"
      />
      <StatCard
        icon={CalendarDays}
        tone="amber"
        label="Week Completion"
        value={`${completionPct}%`}
        sub={`${stats.daysRecorded} of ${stats.schoolDays} days recorded`}
      />
    </div>
  );
}
