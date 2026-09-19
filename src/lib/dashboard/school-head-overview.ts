import "server-only";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  getSchoolHeadIpMetrics,
  getSchoolHeadMetricCounts,
} from "@/lib/dashboard/aggregates";
import {
  getAdviserlessSections,
  type AdviserlessSection,
} from "@/lib/teachers/adviserless";

/**
 * The School Head dashboard's one composed snapshot.
 *
 * A composer, not a query: every field below is read off three functions that
 * are already `cachedQuery`d under `schoolDashboard(schoolId)` in
 * `src/lib/dashboard/aggregates.ts` and `src/lib/teachers/adviserless.ts`. This
 * file adds no `cachedQuery` of its own — re-querying the same rows into a
 * fourth cache entry would risk a new key that forgets to carry `schoolId`, and
 * would let this composed snapshot disagree with the panels that still read
 * `getSchoolHeadMetricCounts` / `getSchoolHeadIpMetrics` directly.
 *
 * `pendingTeacherCount` used to need an uncached read here, because
 * `revalidateSchoolHeadTeachers` did not bust `schoolDashboard(schoolId)` — a
 * head who had just approved every pending teacher would keep seeing a stale
 * "N waiting" for up to the cache's TTL, on the one card whose entire job is to
 * prompt that decision. That gap is fixed at the source: `revalidateSchoolHeadTeachers`
 * (`src/lib/cache/revalidate.ts`) now busts `schoolDashboard(schoolId)` too, so
 * `pendingTeacherCount` is folded into `getSchoolHeadMetricCounts` and read
 * through the normal cached path like everything else here. No uncached read
 * survives in this file.
 */
export type SchoolHeadOverview = {
  learnerCount: number;
  teacherCount: number;
  gradeCount: number;
  sectionCount: number;
  aralCount: number;
  activeYear: { label: string } | null;
  setupTasks: { id: string; label: string; href: string }[];
  pendingTeacherCount: number;
  ipLearners: number;
  totalLearners: number;
  ipPercent: string;
  learnersPerTeacher: string;
  activeTeachers: number;
  adviserlessSections: AdviserlessSection[];
  /** Local `YYYY-MM-DD`, not a query — for the greeting hero's date chip. */
  todayKey: string;
};

export async function getSchoolHeadOverview(
  schoolId: string
): Promise<SchoolHeadOverview> {
  const [metrics, ipMetrics, adviserlessSections] = await Promise.all([
    getSchoolHeadMetricCounts(schoolId),
    getSchoolHeadIpMetrics(schoolId),
    getAdviserlessSections(schoolId),
  ]);

  return {
    learnerCount: metrics.learnerCount,
    teacherCount: metrics.teacherCount,
    gradeCount: metrics.gradeCount,
    sectionCount: metrics.sectionCount,
    aralCount: metrics.aralCount,
    activeYear: metrics.activeYear,
    setupTasks: metrics.setupTasks,
    pendingTeacherCount: metrics.pendingTeacherCount,
    ipLearners: ipMetrics.ipLearners,
    totalLearners: ipMetrics.totalLearners,
    ipPercent: ipMetrics.ipPercent,
    learnersPerTeacher: ipMetrics.learnersPerTeacher,
    activeTeachers: ipMetrics.activeTeachers,
    adviserlessSections,
    todayKey: formatLocalDateKey(schoolToday()),
  };
}

/**
 * One row of "needs your attention". The shape the dashboard's attention panel
 * renders — see `src/components/dashboard/school-head/attention-panel.tsx`
 * (`SchoolAttentionPanel`), which imports this type rather than redeclaring it,
 * since it is exactly what this file's pure builder below produces.
 */
export type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  badge: string | null;
  tone: "amber" | "primary" | "muted";
};

/**
 * Deep links `buildSchoolHeadAttention` needs, pre-resolved by the caller
 * (through `schoolHeadHref(view, ...)`) so this function stays pure and does
 * not need to know about a Super Admin's `?schoolId=` drill-down.
 */
export type SchoolHeadAttentionHrefs = {
  teachers: string;
  gradeLevels: string;
  years: string;
  profiling: string;
};

/** `setupTasks` ids that have a drill-down-safe replacement in `hrefs`. */
const SETUP_TASK_HREF: Record<string, keyof SchoolHeadAttentionHrefs> = {
  profile: "profiling",
  grades: "gradeLevels",
  sections: "gradeLevels",
};

/**
 * Pure: plain facts in, the whole "Needs your attention" list out. No
 * database access, so it is unit-testable without one — the same shape as
 * `buildDashboardTasks` in `src/lib/dashboard/teacher-overview.ts`.
 *
 * Order is severity, an explicit operator decision: no active school year
 * outranks adviserless sections, which outrank pending teacher approvals.
 * `setupTasks` entries follow, then the "all clear" row when the list would
 * otherwise be empty.
 *
 * De-dupes the school-year nudge: `getSchoolHeadMetricCounts` already pushes a
 * "Set an active school year" entry onto `setupTasks` when there is no active
 * year, and the `year` row below covers the same fact, so the `setupTasks`
 * entry whose `id` is `"year"` is dropped here rather than rendered twice.
 */
export function buildSchoolHeadAttention(
  data: SchoolHeadOverview,
  hrefs: SchoolHeadAttentionHrefs
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (!data.activeYear) {
    items.push({
      id: "year",
      label: "Set an active school year",
      detail: "New learners get no enrolment record without one",
      href: hrefs.years,
      badge: "Not set",
      tone: "amber",
    });
  }

  if (data.adviserlessSections.length > 0) {
    const n = data.adviserlessSections.length;
    items.push({
      id: "adviserless",
      label: "Assign advisers",
      detail: `${n} section${n === 1 ? "" : "s"} have learners but no adviser`,
      href: hrefs.gradeLevels,
      badge: `${n} section${n === 1 ? "" : "s"}`,
      tone: "amber",
    });
  }

  if (data.pendingTeacherCount > 0) {
    items.push({
      id: "approvals",
      label: "Approve teacher registrations",
      detail: "They cannot sign in until you decide",
      href: hrefs.teachers,
      badge: `${data.pendingTeacherCount} waiting`,
      tone: "amber",
    });
  }

  for (const task of data.setupTasks) {
    if (task.id === "year") continue; // superseded by the `year` row above
    const hrefKey = SETUP_TASK_HREF[task.id];
    items.push({
      id: `setup:${task.id}`,
      label: task.label,
      detail: "Finish setting up your school",
      href: hrefKey ? hrefs[hrefKey] : task.href,
      badge: null,
      tone: "primary",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "allclear",
      label: "Nothing needs you right now",
      detail: "Your school is fully set up",
      href: "",
      badge: "All clear",
      tone: "muted",
    });
  }

  return items;
}
