import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import type { SchoolHeadTab } from "@/components/school-head/school-head-page";

/**
 * Tab sets for the School Head workspaces. The School pages (Overview, School
 * Year, Grade and Section) are separate sidebar entries, not tabs.
 *
 * Kept out of the pages so three sibling routes cannot disagree about their own
 * tab bar — the failure mode where a tab is added to two of three panels and the
 * third silently drops it. Keys are the URL segment, so a page's `activeTab` is
 * whatever segment it serves.
 */

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
  removed: "removed",
} as const;

export interface TeacherTabCounts {
  active: number;
  pending: number;
  inactive: number;
  declined: number;
  /** Soft-deleted by a removal — a record of who left, not a live account. */
  removed: number;
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
    // Last: the only tab whose rows are not accounts any more.
    {
      key: TEACHER_TABS.removed,
      label: "Removed",
      href: SCHOOL_HEAD_ROUTES.teachersRemoved,
      count: counts.removed,
    },
  ];
}
