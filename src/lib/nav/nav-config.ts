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
  /**
   * Built, but not open to this account. Renders inert on the same terms as
   * `soon` — same pill slot, same skip by every resolver — except the copy names
   * the reason instead of promising a later date.
   *
   * Kept in the list rather than dropped so the person can see the page exists
   * and read why it is shut: a menu that silently loses a row invites "where did
   * Learners go", while an inert row with a reason answers it in place. This is
   * presentation only — the page behind it does its own refusing, because a
   * disabled row is not access control.
   */
  unavailable?: { pill: string; reason: string };
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

/** Capabilities that change how items render rather than whether they exist. */
export interface NavOptions {
  /**
   * A Non-DepEd ARAL Volunteer holds the TEACHER role but advises no section, so
   * the advisory roster has nothing to show them. Renders `Learners` inert with a
   * "DepEd only" pill — present, so the menu does not quietly lose a row, but
   * carrying its own reason. The page refuses on the same condition; the two must
   * agree, or the sidebar either advertises a dead end or hides a live one.
   */
  isAralVolunteer?: boolean;
  /**
   * The grade level of the section this teacher advises, or `null` when they
   * advise none. The End of Terms Reports sheet is grade-scoped
   * (`/teacher/aral/[gradeId]/terms-reports`) but the grade is *derived* from the
   * advised section, so the nav needs this to build a deep href that matches the
   * URL the teacher actually lands on. Without it the row can only name the
   * `/teacher/terms-reports` resolver, whose redirect target no item matches — so
   * the sheet lights up `Dashboard` and takes its title from the URL instead.
   */
  advisoryGradeLevelId?: string | null;
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
  grades: NavGrade[] = [],
  options: NavOptions = {}
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
    case "TEACHER": {
      // Volunteers keep the ARAL group below — that *is* their roster. Learners
      // stays in the list too, inert: they should be able to see that the
      // advisory roster exists and that being non-DepEd is what closes it, rather
      // than find one fewer row than the teacher beside them.
      const learners: NavItem = {
        id: "teacher-learners",
        label: "Learners",
        href: "/teacher/learners",
        icon: BookOpen,
        ...(options.isAralVolunteer
          ? {
              unavailable: {
                pill: "DepEd only",
                // Lower-cased on purpose: renderers compose it as
                // "{label} — {reason}" for the tooltip and the screen-reader
                // text, so a capital here would read as a sentence break.
                reason: "for DepEd teachers who advise a section",
              },
            }
          : {}),
      };
      return [
        {
          label: "Menu",
          items: [
            { id: "teacher-dashboard", label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
            learners,
            // Per-term grades report, not an ARAL surface — it sits with the
            // roster it reports on, even though the sheet itself lives under
            // `/teacher/aral/[gradeId]/`. Same advisory gate as Learners: the
            // sheet is a whole-class artifact only a section adviser can encode.
            //
            // The href is built from `advisoryGradeLevelId`, NOT from
            // `aralHref(grades, "terms-reports")`: `hasAral` is the wrong axis for
            // an advisory-gated sheet, so a DepEd adviser with zero ARAL learners
            // is entitled to it and an ARAL-only tutor is not.
            //
            // The deep href is safe sitting beside the ARAL rows: with 0 or 2+
            // ARAL grades those rows collapse to `/teacher/aral`, which is a
            // prefix of this href, and longest-prefix matching in
            // `resolveActiveHref` therefore still awards the sheet's URL here.
            //
            // With no advisory grade the fallback stays `/teacher/terms-reports`
            // — a real resolver page — rather than `/teacher/aral`: a teacher with
            // no advisory has to land somewhere that *explains* that, and parking
            // this row on the picker's href would let it steal the picker's
            // highlight, because href ties break by list order and this row
            // precedes both ARAL rows.
            {
              id: "teacher-terms-reports",
              label: "End of Terms Reports",
              href: options.advisoryGradeLevelId
                ? `/teacher/aral/${options.advisoryGradeLevelId}/terms-reports`
                : "/teacher/terms-reports",
              icon: FileText,
              ...(options.isAralVolunteer
                ? {
                    unavailable: {
                      pill: "DepEd only",
                      reason: "for DepEd teachers who advise a section",
                    },
                  }
                : {}),
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
    }
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
 * row and title the page after a feature that does not exist yet. An `unavailable`
 * item is skipped for the mirror-image reason: it names a route this account
 * cannot open, so letting it win the highlight would light up a row the person
 * cannot click. Both keep their `href` — it is what the reason refers to — but
 * neither owns the route.
 */
function navigable(items: NavItem[]): NavItem[] {
  return items.filter((i) => !i.soon && !i.unavailable);
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
 * `resolveActiveHref`. `soon` and `unavailable` items are skipped, so a row this
 * account cannot open — `Learners` for a Non-DepEd volunteer, say — cannot take
 * the highlight from a route it names but does not serve. Where two live items
 * share an href, the first in the list wins deterministically so highlighting and
 * React keys never collide.
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
