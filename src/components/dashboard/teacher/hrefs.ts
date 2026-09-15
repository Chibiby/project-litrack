/**
 * Deep links out of the dashboard.
 *
 * ARAL entry is grade-scoped (`/teacher/aral/[gradeId]/…`). When a teacher has
 * exactly one ARAL grade we skip the picker and land them on the work itself;
 * with none or several, the picker is the honest destination. This mirrors
 * `aralHref` in `src/lib/nav/nav-config.ts` — same rule, same reason.
 */
export function aralAttendanceHref(gradeId: string | null): string {
  return gradeId ? `/teacher/aral/${gradeId}/attendance` : "/teacher/aral";
}

export function aralReadingHref(gradeId: string | null): string {
  return gradeId ? `/teacher/aral/${gradeId}/reading-level` : "/teacher/aral";
}

export function learnerHref(gradeId: string, learnerId: string): string {
  return `/teacher/aral/${gradeId}/learners/${learnerId}`;
}

/** ARAL Profiling, opened on the learners who still have no profile. */
export function aralProfilingHref(): string {
  return "/teacher/aral/profiling?status=pending";
}

/**
 * The ARAL Program roster, optionally narrowed to one grade. Profiling has its
 * own page (`aralProfilingHref`), so this is not a profiling queue.
 */
export function aralRosterHref(gradeId: string | null): string {
  return gradeId ? `/teacher/aral?grade=${gradeId}` : "/teacher/aral";
}
