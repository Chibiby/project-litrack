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
            { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
            { label: "Schools", href: "/admin/schools", icon: School },
            { label: "Transfers", href: "/admin/transfers", icon: ArrowRightLeft },
            { label: "School years", href: "/admin/school-years", icon: CalendarRange },
            { label: "Audit", href: "/admin/audit", icon: ScrollText },
          ],
        },
      ];
    case "SCHOOL_HEAD":
      return [
        {
          items: [
            { label: "Dashboard", href: "/school-head", icon: LayoutDashboard },
            { label: "School years", href: "/school-head/school-years", icon: CalendarRange },
            { label: "Grade Levels", href: "/school-head/grade-levels", icon: GraduationCap },
            { label: "Teachers", href: "/school-head/teachers", icon: Users },
            { label: "ARAL", href: "/school-head/aral", icon: Sparkles },
            { label: "Transfer", href: "/school-head/transfer", icon: ArrowRightLeft },
            { label: "Announcements", href: "/school-head/announcements", icon: Megaphone },
            { label: "School info", href: "/school-head/school-info", icon: Building2 },
            { label: "Reports", href: "/school-head/reports", icon: FileBarChart },
            { label: "Audit", href: "/school-head/audit", icon: ScrollText },
          ],
        },
      ];
    case "TEACHER":
      return [
        {
          label: "Menu",
          items: [
            { label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
            { label: "Learners", href: "/teacher/learners", icon: BookOpen },
          ],
        },
        {
          label: "ARAL Program",
          items: [
            {
              label: "Weekly Attendance",
              href: aralHref(grades, "attendance"),
              icon: CalendarDays,
            },
            {
              label: "Monthly Reading Level",
              href: aralHref(grades, "reading-level"),
              icon: BookOpen,
            },
            {
              label: "End of Terms Reports",
              href: "/teacher/reports",
              icon: FileText,
            },
          ],
        },
        {
          items: [{ label: "Reports", href: "/teacher/reports", icon: FileBarChart }],
        },
      ];
    default:
      return [];
  }
}

export function flattenNavGroups(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}

/** Single active href: exact match preferred; otherwise longest prefix. Role-root hrefs (e.g. `/teacher`) only match exactly, so nested non-nav routes fall through instead of being claimed as "home". */
export function resolveActiveHref(
  pathname: string,
  items: NavItem[]
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const isRoleRoot = item.href.split("/").filter(Boolean).length <= 1;
    const matches =
      pathname === item.href || (!isRoleRoot && pathname.startsWith(`${item.href}/`));
    if (!matches) continue;
    if (!best || item.href.length > best.length) {
      best = item.href;
    }
  }
  return best;
}

function humanise(segment: string): string {
  const words = segment.replaceAll("-", " ").trim();
  if (!words) return "LITRACK";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Header title: the active nav label, else a humanised trailing segment. */
export function resolvePageTitle(pathname: string, groups: NavGroup[]): string {
  const items = flattenNavGroups(groups);
  const active = resolveActiveHref(pathname, items);
  if (active) {
    const match = items.find((i) => i.href === active);
    if (match) return match.label;
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? humanise(last) : "LITRACK";
}
