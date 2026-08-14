import {
  ArrowRightLeft,
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  FileBarChart,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  School,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";
import type { UserRole } from "@prisma/client";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
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
            { id: "school-head-dashboard", label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
            { id: "school-head-school-years", label: "School years", href: "/school-head/school-years", icon: CalendarRange },
            { id: "school-head-grade-levels", label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
            { id: "school-head-teachers", label: "Teachers", href: "/school-head/teachers", icon: Users },
            { id: "school-head-aral", label: "ARAL", href: "/school-head/aral", icon: Sparkles },
            { id: "school-head-transfer", label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
            { id: "school-head-announcements", label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
            { id: "school-head-school-info", label: "School info", href: "/school-head/school-info", icon: Building2 },
            { id: "school-head-reports", label: "Reports", href: "/school-head/reports", icon: FileBarChart },
            { id: "school-head-audit", label: "Audit", href: "/school-head/audit", icon: ScrollText },
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
            {
              id: "teacher-terms-reports",
              label: "End of Terms Reports",
              href: "/teacher/reports",
              icon: FileText,
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

/** Single active href: exact match preferred; otherwise longest prefix. */
export function resolveActiveHref(
  pathname: string,
  items: NavItem[]
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
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
 * `resolveActiveHref`. When multiple items share an href (e.g. two teacher
 * entries both point at `/teacher/reports`), the first item in the list
 * wins deterministically so highlighting and React keys never collide.
 */
export function resolveActiveItemId(
  pathname: string,
  items: NavItem[]
): string | undefined {
  const activeHref = resolveActiveHref(pathname, items);
  if (!activeHref) return undefined;
  return items.find((i) => i.href === activeHref)?.id;
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
 * `/teacher/settings/...`) would misreport as "Dashboard".
 */
export function resolvePageTitle(pathname: string, groups: NavGroup[]): string {
  const items = flattenNavGroups(groups);
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
