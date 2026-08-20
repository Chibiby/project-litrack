import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import type { SchoolHeadTab } from "@/components/school-head/school-head-page";

/**
 * Tab sets for the two School Head workspaces.
 *
 * Kept out of the pages so three sibling routes cannot disagree about their own
 * tab bar — the failure mode where a tab is added to two of three panels and the
 * third silently drops it. Keys are the URL segment, so a page's `activeTab` is
 * whatever segment it serves.
 */

/**
 * School setup: grade levels, years and school info are one job — configure the
 * school — so they read as tabs rather than three unrelated sidebar entries.
 * Grade levels leads because it is the one a new head must do first: no grade
 * levels means no sections, no advisories, and no learners. It is also the
 * workspace root, so its tab href is the bare workspace path.
 *
 * Keys are opaque identifiers, not URL segments — grade levels has no segment.
 */
export const SCHOOL_TABS = {
  gradeLevels: "grade-levels",
  years: "years",
  info: "info",
} as const;

export const SCHOOL_WORKSPACE_TABS: SchoolHeadTab[] = [
  {
    key: SCHOOL_TABS.gradeLevels,
    label: "Grade levels",
    href: SCHOOL_HEAD_ROUTES.school,
  },
  {
    key: SCHOOL_TABS.years,
    label: "School years",
    href: SCHOOL_HEAD_ROUTES.schoolYears,
  },
  {
    key: SCHOOL_TABS.info,
    label: "School information",
    href: SCHOOL_HEAD_ROUTES.schoolInfo,
  },
];

/**
 * Teacher roster states. These were four tables stacked down one page, so the
 * pending queue — the only one that needs a decision — sat below two tables that
 * never do.
 */
export const TEACHER_TABS = {
  active: "active",
  pending: "pending",
  inactive: "inactive",
  declined: "declined",
} as const;

export interface TeacherTabCounts {
  active: number;
  pending: number;
  inactive: number;
  declined: number;
}

/**
 * Counts come from the page because they are per-school and a Next layout never
 * receives `searchParams` — a layout could not tell a Super Admin's drill-down
 * from the head's own school, and would count the wrong one.
 *
 * Only Pending emphasises its count: it is the sole state awaiting an action.
 */
export function teacherWorkspaceTabs(counts: TeacherTabCounts): SchoolHeadTab[] {
  return [
    {
      key: TEACHER_TABS.active,
      label: "Active",
      href: SCHOOL_HEAD_ROUTES.teachers,
      count: counts.active,
    },
    {
      key: TEACHER_TABS.pending,
      label: "Pending",
      href: SCHOOL_HEAD_ROUTES.teachersPending,
      count: counts.pending,
      emphasizeCount: true,
    },
    {
      key: TEACHER_TABS.inactive,
      label: "Inactive",
      href: SCHOOL_HEAD_ROUTES.teachersInactive,
      count: counts.inactive,
    },
    {
      key: TEACHER_TABS.declined,
      label: "Declined",
      href: SCHOOL_HEAD_ROUTES.teachersDeclined,
      count: counts.declined,
    },
  ];
}
