"use client";

import { CalendarClock, CheckCircle2, ClipboardList, Users } from "lucide-react";
import { StatCard, StatCardRow } from "@/components/dashboard/teacher/stat-cards";
import type { ProfilingStats } from "@/lib/aral/profiling-stats";

/**
 * The four summary cards above the ARAL Profiling tabs, computed by
 * `computeProfilingStats`. Reuses the app's shared `StatCard`/`StatCardRow`
 * (Learners, Weekly Attendance) rather than bespoke markup.
 */
export function ProfilingStatCards({ stats }: { stats: ProfilingStats }) {
  return (
    <StatCardRow>
      <StatCard
        title="Total ARAL Learners"
        value={stats.total}
        hint="Learners for profiling"
        icon={Users}
        tone="violet"
        decor="people"
        inlineOnPhone
        denseOnPhone
      />
      <StatCard
        title="Pending Profiles"
        value={stats.pending}
        hint="Still need a profile"
        icon={ClipboardList}
        tone="amber"
        decor="clock"
        inlineOnPhone
        denseOnPhone
      />
      <StatCard
        title="Completed Profiles"
        value={stats.completed}
        hint="Profiles completed"
        icon={CheckCircle2}
        tone="emerald"
        decor="bars"
        inlineOnPhone
        denseOnPhone
        progress={stats.completionPct}
        progressLabel={`${stats.completed} of ${stats.total} ARAL learner${stats.total === 1 ? "" : "s"} profiled`}
      />
      <StatCard
        title="Last Updated"
        value={stats.lastUpdatedDisplay}
        hint={stats.hint}
        icon={CalendarClock}
        tone="primary"
        decor="wave"
        inlineOnPhone
        denseOnPhone
        valueClassName="text-base sm:text-xl"
      />
    </StatCardRow>
  );
}
