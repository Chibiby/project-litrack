const dateFormat = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export const PROFILING_STATUSES = ["all", "pending", "completed"] as const;
export type ProfilingStatusFilter = (typeof PROFILING_STATUSES)[number];

export const PROFILING_STATUS_LABELS: Record<ProfilingStatusFilter, string> = {
  all: "All",
  pending: "Pending",
  completed: "Completed",
};

/** Parse `?status=`, falling back to `"all"` on anything unknown. */
export function parseProfilingStatus(raw: string | undefined): ProfilingStatusFilter {
  return (PROFILING_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as ProfilingStatusFilter)
    : "all";
}

export type ProfilingStatsInput = {
  /** Every ARAL learner in the teacher's tutor scope. */
  total: number;
  /** Learners in scope with no saved `AralProfile`. */
  pending: number;
  /** Most recent `AralProfile.updatedAt` in scope, or `null` when none is saved yet. */
  lastUpdatedAt: Date | null;
};

export type ProfilingStats = {
  total: number;
  pending: number;
  /** `total - pending`, floored at zero. */
  completed: number;
  /** 0–100, `0` when `total` is `0`. */
  completionPct: number;
  /** Short local date, or an em dash when nothing has been saved yet. */
  lastUpdatedDisplay: string;
  hint: string;
};

/**
 * Pure ARAL-profiling card math shared by the stat cards and its Vitest
 * coverage, mirroring `computeWeekStats`/`computeReadingLevelStats`. No
 * Prisma, no React — just the four numbers the mockup's cards show.
 */
export function computeProfilingStats({
  total,
  pending,
  lastUpdatedAt,
}: ProfilingStatsInput): ProfilingStats {
  const completed = Math.max(0, total - pending);
  const completionPct =
    total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : 0;
  const lastUpdatedDisplay = lastUpdatedAt ? dateFormat.format(lastUpdatedAt) : "—";
  const hint = lastUpdatedAt ? "Most recent profile saved" : "No profiles completed yet";

  return { total, pending, completed, completionPct, lastUpdatedDisplay, hint };
}
