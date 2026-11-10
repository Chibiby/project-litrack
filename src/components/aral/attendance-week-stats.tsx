"use client";

import { CalendarDays, CheckCircle2, Percent, Users } from "lucide-react";
import { StatCard, StatCardRow } from "@/components/dashboard/teacher/stat-cards";
import type { WeekStats } from "@/lib/attendance/week-stats";

/**
 * The four summary cards above the week-status banner, computed from the week
 * currently loaded in the grid. See `computeWeekStats` for the math. Reuses
 * the app's shared `StatCard`/`StatCardRow` (Learners, End of Terms) rather
 * than bespoke markup, so the phone layout is the same two-up grid those
 * pages already use.
 */
export function AttendanceWeekStats({ stats }: { stats: WeekStats }) {
  const completionPct =
    stats.schoolDays > 0
      ? Math.round((stats.daysRecorded / stats.schoolDays) * 100)
      : 0;

  return (
    <StatCardRow>
      <StatCard
        title="Total Learners"
        value={stats.learnerCount}
        hint="ARAL learners in view"
        icon={Users}
        tone="amber"
        denseOnPhone
      />
      <StatCard
        title="Present Marks"
        value={stats.presentMarks}
        hint={`out of ${stats.possible} possible days`}
        icon={CheckCircle2}
        tone="emerald"
        denseOnPhone
      />
      <StatCard
        title="Attendance Rate"
        value={`${stats.ratePct}%`}
        hint="This week's rate"
        icon={Percent}
        tone="primary"
        denseOnPhone
      />
      <StatCard
        title="Week Completion"
        value={`${completionPct}%`}
        hint={`${stats.daysRecorded} of ${stats.schoolDays} days recorded`}
        icon={CalendarDays}
        tone="violet"
        denseOnPhone
        progress={completionPct}
      />
    </StatCardRow>
  );
}
