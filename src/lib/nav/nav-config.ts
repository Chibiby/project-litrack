import {
  ArrowRightLeft,
  BookOpen,
  CalendarDays,
  CalendarRange,
  FileBarChart,
  FileText,
  LayoutDashboard,
  Megaphone,
  School,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  /**
   * Announced but not built. The item renders as inert text with a "Soon" pill,
   * and every resolver below skips it — so an item parked on an href another item
   * already serves cannot steal that route's highlight or header title.
   */
  soon?: boolean;
}

/** A labelled sidebar section. `label` omitted renders the items with no heading. */
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface NavGrade {
  id: string;
  label: string;
  hasAral?: boolean;
}

/**
 * ARAL weekly/monthly entry is grade-scoped (`/teacher/aral/[gradeId]/…`).
 * With exactly one ARAL grade we can skip the picker; otherwise link to it.
 */
function aralHref(grades: NavGrade[], suffix: string): string {
  const aralGrades = grades.filter((g) => g.hasAral);
  if (aralGrades.length !== 1) return "/teacher/aral";
  return `/teacher/aral/${aralGrades[0].id}/${suffix}`;
}

export function getNavGroups(
  role: UserRole,
  grades: NavGrade[] = []
): NavGroup[] {
  switch (role) {
    case "SUPER_ADMIN":
      return [
        {
          items: [
            { id: "admin-dashboard", label: "Dashboard", href: "/admin", icon: LayoutDashboard },
            { id: "admin-schools", label: "Schools", href: "/admin/schools", icon: School },
            { id: "admin-transfers", label: "Transfers", href: "/admin/transfers", icon: ArrowRightLeft },
            { id: "admin-school-years", label: "School years", href: "/admin/school-years", icon: CalendarRange },
            { id: "admin-audit", label: "Audit", href: "/admin/audit", icon: ScrollText },
          ],
        },
      ];
    case "SCHOOL_HEAD":
      return [
        {
          items: [
            { id: "school-head-dashboard", label: "Dashboard", href: SCHOOL_HEAD_ROUTES.dashboard, icon: LayoutDashboard },
          ],
        },
        {
          // Things a School Head changes. "School" replaces the three separate
          // entries (school years, grade levels, school info) that were really
          // one job; they are tabs inside the workspace now.
          label: "Manage",
          items: [
            { id: "school-head-school", label: "School", href: SCHOOL_HEAD_ROUTES.school, icon: School },
            { id: "school-head-teachers", label: "Teachers", href: SCHOOL_HEAD_ROUTES.teachers, icon: Users },
            { id: "school-head-aral", label: "ARAL Program", href: SCHOOL_HEAD_ROUTES.aral, icon: Sparkles },
            { id: "school-head-transfer", label: "Transfer", href: SCHOOL_HEAD_ROUTES.transfer, icon: ArrowRightLeft },
          ],
        },
        {
          // Things a School Head publishes or reads back.
          label: "Records",
          items: [
            { id: "school-head-announcements", label: "Announcements", href: SCHOOL_HEAD_ROUTES.announcements, icon: Megaphone },
            { id: "school-head-reports", label: "Reports", href: SCHOOL_HEAD_ROUTES.reports, icon: FileBarChart },
            { id: "school-head-audit", label: "Audit", href: SCHOOL_HEAD_ROUTES.audit, icon: ScrollText },
          ],
        },
      ];
    case "TEACHER":
      return [
        {
          label: "Menu",
          items: [
            { id: "teacher-dashboard", label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
            { id: "teacher-learners", label: "Learners", href: "/teacher/learners", icon: BookOpen },
            // Per-term grades report, not an ARAL surface — it sits with the
            // roster it reports on. Keeps its href for when it is wired; `soon`
            // is what stops it shadowing the live Reports item below.
            {
              id: "teacher-terms-reports",
              label: "End of Terms Reports",
              href: "/teacher/reports",
              icon: FileText,
              soon: true,
            },
          ],
        },
        {
          label: "ARAL Program",
          items: [
            {
              id: "teacher-aral-attendance",
              label: "Weekly Attendance",
              href: aralHref(grades, "attendance"),
              icon: CalendarDays,
            },
            {
              id: "teacher-aral-reading-level",
              label: "Monthly Reading Level",
              href: aralHref(grades, "reading-level"),
              icon: BookOpen,
            },
          ],
        },
        {
          items: [{ id: "teacher-reports", label: "Reports", href: "/teacher/reports", icon: FileBarChart }],
        },
      ];
    default:
      return [];
  }
}

export function flattenNavGroups(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * The items that actually serve a route. A `soon` item is a placeholder parked on
 * the href it will eventually own, so resolving against it would highlight a dead
 * row and title the page after a feature that does not exist yet.
 */
function navigable(items: NavItem[]): NavItem[] {
  return items.filter((i) => !i.soon);
}

/** Single active href: exact match preferred; otherwise longest prefix. */
export function resolveActiveHref(
  pathname: string,
  items: NavItem[]
): string | undefined {
  let best: string | undefined;
  for (const item of navigable(items)) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (!best || item.href.length > best.length) {
      best = item.href;
    }
  }
  return best;
}

function isRoleRootHref(href: string): boolean {
  return href.split("/").filter(Boolean).length <= 1;
}

/**
 * Single active item id, resolved by the same longest-prefix rule as
 * `resolveActiveHref`. `soon` items are skipped, so `End of Terms Reports` —
 * parked on `/teacher/reports` until it is built — cannot take the highlight from
 * the live `Reports` item that serves the route. Where two live items share an
 * href, the first in the list wins deterministically so highlighting and React
 * keys never collide.
 */
export function resolveActiveItemId(
  pathname: string,
  items: NavItem[]
): string | undefined {
  const activeHref = resolveActiveHref(pathname, items);
  if (!activeHref) return undefined;
  return navigable(items).find((i) => i.href === activeHref)?.id;
}

function humanise(segment: string): string {
  const words = segment.replaceAll("-", " ").trim();
  if (!words) return "LITRACK";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Header title: the active nav item's label, else a humanised trailing
 * segment. A role-root item (e.g. `/teacher`) only supplies its label on an
 * exact pathname match — otherwise unrelated nested routes (e.g.
 * `/teacher/settings/...`) would misreport as "Dashboard". `soon` items never
 * supply a title, for the same reason they never take the highlight.
 */
export function resolvePageTitle(pathname: string, groups: NavGroup[]): string {
  const items = navigable(flattenNavGroups(groups));
  const activeHref = resolveActiveHref(pathname, items);
  if (activeHref) {
    const match = items.find((i) => i.href === activeHref);
    if (match && (pathname === match.href || !isRoleRootHref(match.href))) {
      return match.label;
    }
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? humanise(last) : "LITRACK";
}
