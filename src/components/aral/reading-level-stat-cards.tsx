"use client";

import { BarChart3, CalendarDays, ClipboardList, TrendingUp, Users } from "lucide-react";
import { StatCard, type StatTone } from "@/components/dashboard/teacher/stat-cards";
import type { ReadingLevelStats } from "@/lib/aral/reading-level-stats";

/**
 * The five summary cards above the monthly reading-level toolbar, computed
 * from the month currently loaded in the grid. See `computeReadingLevelStats`
 * for the math. Reuses the app's shared `StatCard` in a 2-up (phone) / 5-up
 * (xl) grid rather than `StatCardRow`, which is 4-up.
 */
export function ReadingLevelStatCards({
  stats,
  statusLabel,
  statusBody,
  statusTone,
  monthLabel,
}: {
  stats: ReadingLevelStats;
  /** e.g. "Open" / "Locked" / "Past due" / "Upcoming" / "Reopened" — the panel's own `monthStatus().label`. */
  statusLabel: string;
  /** The status body text the panel already computes (`monthStatus().body`). */
  statusBody: string;
  /** The panel's own `monthStatus().tone` — the colour cue the label alone can't carry. */
  statusTone: StatTone;
  /** `formatMonthLabel(pickerMonth)` — the month the Completion Rate progressbar announces. */
  monthLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
      <StatCard
        title="Monthly Status"
        value={statusLabel}
        hint={statusBody}
        icon={CalendarDays}
        tone={statusTone}
        inlineOnPhone
        denseOnPhone
      />
      <StatCard
        title="Total Learners Assessed"
        value={`${stats.assessed} / ${stats.total}`}
        hint={`${stats.completionPct}% assessed`}
        icon={Users}
        tone="primary"
        decor="people"
        inlineOnPhone
        denseOnPhone
      />
      <StatCard
        title="Pending Assessments"
        value={stats.pending}
        hint={`Out of ${stats.total} learners`}
        icon={ClipboardList}
        tone="amber"
        decor="bars"
        inlineOnPhone
        denseOnPhone
      />
      <StatCard
        title="Completion Rate"
        value={`${stats.completionPct}%`}
        hint={`${stats.assessed} of ${stats.total} learners`}
        icon={BarChart3}
        tone="emerald"
        progress={stats.completionPct}
        progressLabel={`${stats.assessed} of ${stats.total} learners assessed in ${monthLabel}`}
        inlineOnPhone
        denseOnPhone
      />
      <div className="col-span-2 xl:col-span-1 [&>*]:h-full">
        <StatCard
          title="Average Reading Progress"
          value={stats.averageLabel ?? "—"}
          hint="Based on assessed learners"
          icon={TrendingUp}
          tone="pink"
          decor="wave"
          inlineOnPhone
          denseOnPhone
          valueClassName="text-base sm:text-xl lg:text-2xl"
        />
      </div>
    </div>
  );
}
