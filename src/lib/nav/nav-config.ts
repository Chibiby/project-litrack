import { ALL_GRADES_ATTENDANCE_PATH } from "@/lib/aral/all-grades";
import {
  Archive,
  ArrowRightLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  CalendarRange,
  BookOpenCheck,
  ClipboardCheck,
  ClipboardList,
  Database,
  Gauge,
  FileBarChart,
  FileCheck2,
  FileText,
  Feather,
  FlaskConical,
  GraduationCap,
  HandHelping,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  MapPinned,
  Megaphone,
  School,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Sparkles,
  Unlock,
  UserCog,
  UserX,
  Users,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { DISTRICT_ROUTES } from "@/lib/routes/district";

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
  /**
   * Opts this row out of hover/focus intent-prefetch (`PrefetchLink`'s
   * `intent` prop). Set on routes whose render is too heavy to speculate on
   * — a mouse merely passing down the sidebar must not trigger a full
   * server render of them. Archive is the first: it is `force-dynamic`,
   * reads two global cross-tenant tables without their supporting indexes
   * applied yet, and running that against the pooler's floor of 3
   * connections starved unrelated requests in production. Ordinary click
   * navigation is unaffected — this only removes the speculative render.
   */
  heavy?: true;
  /**
   * Extra routes this row owns, for pages that live under no row's path. A
   * learner-scoped ARAL page sits under /teacher/aral/<gradeId>/learners/<id>/,
   * which no ARAL row is a prefix of, so plain longest-prefix matching hands it
   * to the role root (/teacher) and lights Dashboard up while the person is
   * filling in an ARAL profile. A pattern match wins over every prefix match,
   * because a row only claims a route this way deliberately.
   */
  alsoOwns?: RegExp;
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
   * A Non-DepEd ARAL Volunteer holds the TEACHER role but advises no section and
   * only tutors ARAL learners. Their menu is Dashboard and ARAL Program only: the
   * Advisory group (Learners, End of Terms Reports, BOSY, MOSY) and Analytics are
   * dropped. Those advisory pages refuse them on the same condition
   * (`advisoryRosterDenial`); the two must agree.
   */
  isAralVolunteer?: boolean;
  /**
   * A DepEd teacher whose `advisoryMode` is FLOATING — a declared choice not to
   * advise a section, distinct from an ordinary teacher who simply has not been
   * assigned one yet. Renders `Learners` and `End of Terms Reports` inert with a
   * "Floating teacher" pill; see `advisoryRosterDenial`. If `isAralVolunteer` is
   * also set, the volunteer pill wins — a volunteer is not a DepEd teacher at
   * all, so their reason takes precedence over a mode that only applies to one.
   */
  isFloating?: boolean;
  /**
   * Every section this teacher advises, grade derived from each. Still passed
   * by the shell, but the End of Terms Reports row no longer needs it: the v2
   * sheet lives at one URL for every advisory — see `termsReportsHref`.
   */
  advisoryPlacements?: { sectionId: string; gradeLevelId: string }[];
  /**
   * Teachers waiting on the School Head's approve/reject decision. Shows as a
   * count badge on the Teachers row; omitted (not zero) hides the badge, so an
   * empty queue renders no badge at all rather than a "0".
   */
  pendingTeacherCount?: number;
  /**
   * Super Admin whose tier is DEVELOPER. Adds the Developer Controls group
   * (audit log, error log, Page Test Lab, archive, database console); a
   * Division Admin's menu has no such group. See `isDeveloperAdmin`.
   */
  isDeveloperAdmin?: boolean;
}

/** The ARAL Profiling list: Sections C–E status for every ARAL learner a teacher is the ARAL tutor of. */
export const ARAL_PROFILING_HREF = "/teacher/aral/profiling";

/**
 * The MOSY Report list: middle-of-year level and ARAL decision for the ARAL
 * learners in the teacher's own advisory. Sits in the Advisory group, after End
 * of Terms Reports, and is inert for volunteers and floating teachers.
 */
export const ARAL_MOSY_HREF = "/teacher/aral/mosy";

/**
 * The BOSY Report list: the reading levels each ARAL learner of the teacher's
 * advisory was enrolled with. Read-only. Same advisory gate and scope as MOSY,
 * and sits directly above it in the Advisory group.
 */
export const ARAL_BOSY_HREF = "/teacher/aral/bosy";

/**
 * Where the "End of Terms Reports" row points: always `/teacher/terms-reports`.
 *
 * v2 puts the sheet itself there, opening on All Advisories, so one URL serves
 * a teacher with one advisory, several, or none (the page explains why it is
 * shut). The old grade-scoped URL redirects a teacher here.
 */
export function termsReportsHref(): string {
  return "/teacher/terms-reports";
}

/**
 * ARAL weekly/monthly entry is grade-scoped (`/teacher/aral/[gradeId]/…`).
 *
 * Links to that page for the first grade with ARAL learners. With several ARAL
 * grades the row used to fall back to the /teacher/aral picker, so Weekly
 * Attendance and Monthly Reading Level both opened the ARAL Program page
 * instead of their own. Both pages switch grades in place, and `alsoOwns`
 * keeps the row lit on every grade's copy. Only a teacher with no ARAL grade
 * still lands on the picker, which explains how to enroll.
 */
/**
 * Weekly Attendance opens on every grade at once wherever its grade picker
 * would offer a choice (more than one grade), the all-grades page being that
 * picker's default. One grade keeps the per-grade page.
 */
function aralAttendanceNavHref(grades: NavGrade[]): string {
  if (grades.length > 1 && grades.some((g) => g.hasAral)) return ALL_GRADES_ATTENDANCE_PATH;
  return aralHref(grades, "attendance");
}

function aralHref(grades: NavGrade[], suffix: string): string {
  const first = grades.find((g) => g.hasAral);
  if (!first) return "/teacher/aral";
  return `/teacher/aral/${first.id}/${suffix}`;
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
          label: "Overview",
          items: [
            { id: "admin-dashboard", label: "Dashboard", href: ADMIN_ROUTES.home, icon: LayoutDashboard },
          ],
        },
        {
          // Group labels mirror the URL segment each row lives under
          // (`/admin/management/…`, `/admin/school-setup/…`, …).
          label: "Management",
          items: [
            { id: "admin-learners", label: "Learners", href: ADMIN_ROUTES.learners, icon: GraduationCap },
            { id: "admin-ip-learners", label: "IP Learners", href: ADMIN_ROUTES.ipLearners, icon: Feather },
            { id: "admin-teachers", label: "Teachers", href: ADMIN_ROUTES.teachers, icon: Users, heavy: true },
            { id: "admin-aral-teachers", label: "ARAL Tutors", href: ADMIN_ROUTES.aralTeachers, icon: HandHelping },
            { id: "admin-school-heads", label: "School Heads", href: ADMIN_ROUTES.schoolHeads, icon: ShieldCheck, heavy: true },
            { id: "admin-schools", label: "Schools", href: ADMIN_ROUTES.schools, icon: School },
            { id: "admin-transfers", label: "Transfers", href: ADMIN_ROUTES.transfers, icon: ArrowRightLeft },
            { id: "admin-district-admins", label: "District Admins", href: ADMIN_ROUTES.districtAdmins, icon: MapPinned, heavy: true },
          ],
        },
        {
          label: "School Setup",
          items: [
            { id: "admin-school-years", label: "School Years", href: ADMIN_ROUTES.schoolYears, icon: CalendarRange },
            { id: "admin-term-subjects", label: "End-of-Term Subjects", href: ADMIN_ROUTES.termSubjects, icon: ListOrdered },
            { id: "admin-submissions", label: "Report Submissions", href: ADMIN_ROUTES.reportSubmissions, icon: FileCheck2 },
          ],
        },
        {
          label: "Monitoring",
          items: [
            { id: "admin-summary", label: "Division Summary", href: ADMIN_ROUTES.divisionSummary, icon: BarChart3 },
            { id: "admin-support", label: "Support Inbox", href: ADMIN_ROUTES.support, icon: LifeBuoy },
            { id: "admin-deleted-records", label: "Deleted Records", href: ADMIN_ROUTES.deletedRecords, icon: Archive, heavy: true },
          ],
        },
        // Developer Admin only. Dropped, not rendered inert: a Division Admin
        // is not meant to know these exist, and the pages 404 for them too.
        ...(options.isDeveloperAdmin
          ? [
              {
                label: "Developer Controls",
                items: [
                  { id: "admin-admin-accounts", label: "Admin Accounts", href: ADMIN_ROUTES.adminAccounts, icon: UserCog, heavy: true as const },
                  { id: "admin-audit", label: "Audit Log", href: ADMIN_ROUTES.audit, icon: ScrollText },
                  { id: "admin-errors", label: "Error Log", href: ADMIN_ROUTES.errors, icon: TriangleAlert },
                  { id: "admin-test-lab", label: "Page Test Lab", href: ADMIN_ROUTES.testLab, icon: FlaskConical },
                  { id: "admin-database", label: "Database Console", href: ADMIN_ROUTES.database, icon: Database },
                  { id: "admin-rate-limits", label: "Rate Limits", href: ADMIN_ROUTES.rateLimits, icon: Gauge },
                ],
              },
            ]
          : []),
      ];
    case "SCHOOL_HEAD":
      return [
        {
          label: "Overview",
          items: [
            { id: "school-head-dashboard", label: "Dashboard", href: SCHOOL_HEAD_ROUTES.dashboard, icon: LayoutDashboard },
          ],
        },
        {
          label: "Management",
          items: [
            { id: "school-head-learners", label: "Learners", href: SCHOOL_HEAD_ROUTES.learners, icon: GraduationCap },
            {
              id: "school-head-teachers",
              label: "Teachers",
              href: SCHOOL_HEAD_ROUTES.teachers,
              icon: Users,
              ...(options.pendingTeacherCount ? { badge: options.pendingTeacherCount } : {}),
            },
            { id: "school-head-aral-teachers", label: "ARAL Tutors", href: SCHOOL_HEAD_ROUTES.aralTeachers, icon: HandHelping },
            { id: "school-head-transfer", label: "Transfer", href: SCHOOL_HEAD_ROUTES.transfer, icon: ArrowRightLeft },
          ],
        },
        {
          // What the head checks on: who is behind, and records that do not add up.
          label: "Monitoring",
          items: [
            {
              id: "school-head-monitoring-non-compliance",
              label: "Non-compliance",
              href: SCHOOL_HEAD_ROUTES.monitoringNonCompliance,
              icon: ClipboardCheck,
            },
            {
              id: "school-head-monitoring-aral",
              label: "ARAL Monitoring",
              href: SCHOOL_HEAD_ROUTES.monitoringAral,
              icon: BookOpenCheck,
            },
            {
              id: "school-head-monitoring-discrepancies",
              label: "Discrepancies",
              href: SCHOOL_HEAD_ROUTES.monitoringDiscrepancies,
              icon: TriangleAlert,
            },
          ],
        },
        {
          // Everything about the school itself: its details, its year, its
          // grades and sections, and the programmes it runs. Overview, School
          // Year and Grade and Section were once tabs of one "School Setup"
          // page; each is its own entry now. Longest-prefix matching keeps
          // Grade and Section (`/school-head/school`) from lighting up on the
          // other two, whose paths extend it.
          label: "School",
          items: [
            { id: "school-head-school-info", label: "Overview", href: SCHOOL_HEAD_ROUTES.schoolInfo, icon: School },
            { id: "school-head-school-years", label: "School Year", href: SCHOOL_HEAD_ROUTES.schoolYears, icon: CalendarRange },
            { id: "school-head-school", label: "Grade and Section", href: SCHOOL_HEAD_ROUTES.school, icon: Layers },
            { id: "school-head-term-subjects", label: "End-of-Term Subjects", href: SCHOOL_HEAD_ROUTES.termSubjects, icon: ListOrdered },
            { id: "school-head-aral", label: "ARAL Program", href: SCHOOL_HEAD_ROUTES.aral, icon: Sparkles },
            { id: "school-head-kinder-checklist", label: "Kindergarten Checklist", href: SCHOOL_HEAD_ROUTES.kinderChecklist, icon: ClipboardList },
          ],
        },
        {
          // Things a School Head publishes or reads back.
          label: "Communication & Records",
          items: [
            { id: "school-head-announcements", label: "Announcements", href: SCHOOL_HEAD_ROUTES.announcements, icon: Megaphone },
            { id: "school-head-reports", label: "Reports", href: SCHOOL_HEAD_ROUTES.reports, icon: FileBarChart },
            // `=== false`, not falsy: a real School Head passes no tier at all,
            // while a Division Admin viewing the school passes an explicit false
            // and the audit page 404s for them.
            ...(options.isDeveloperAdmin === false
              ? []
              : [{ id: "school-head-audit", label: "Audit Log", href: SCHOOL_HEAD_ROUTES.audit, icon: ScrollText }]),
          ],
        },
      ];
    case "TEACHER": {
      // A floating DepEd teacher keeps the Advisory rows, inert, worded for
      // their reason: they are a DepEd teacher who could advise a section. A
      // Non-DepEd ARAL Volunteer never will, so their menu is ARAL only (the
      // Advisory and Analytics groups are dropped below).
      const classLock = options.isFloating
        ? { pill: "Floating teacher", reason: "for teachers who advise a section" }
        : null;
      const learners: NavItem = {
        id: "teacher-learners",
        label: "Learners",
        href: "/teacher/learners",
        icon: BookOpen,
        ...(classLock ? { unavailable: classLock } : {}),
      };
      const groups: NavGroup[] = [
        {
          items: [{ id: "teacher-dashboard", label: "Dashboard", href: "/teacher", icon: LayoutDashboard }],
        },
        {
          label: "Advisory",
          items: [
            learners,
            // Per-term grades report, not an ARAL surface — it sits with the
            // roster it reports on, even though the sheet itself lives under
            // `/teacher/aral/[gradeId]/`. Same advisory gate as Learners: the
            // sheet is a whole-class artifact only a section adviser can encode.
            //
            // Not `aralHref(grades, "terms-reports")`: `hasAral` is the wrong axis
            // for an advisory-gated sheet, so a DepEd adviser with zero ARAL
            // learners is entitled to it and an ARAL-only teacher is not.
            {
              id: "teacher-terms-reports",
              label: "End of Terms Reports",
              href: termsReportsHref(),
              icon: FileText,
              ...(classLock ? { unavailable: classLock } : {}),
            },
            // Lists only the ARAL learners of the teacher's own advisory, so it
            // shares the advisory gate rather than sitting with the ARAL tools.
            {
              id: "teacher-aral-bosy",
              label: "BOSY Report",
              href: ARAL_BOSY_HREF,
              icon: ClipboardList,
              ...(classLock ? { unavailable: classLock } : {}),
            },
            {
              id: "teacher-aral-mosy",
              label: "MOSY Report",
              href: ARAL_MOSY_HREF,
              icon: ClipboardCheck,
              ...(classLock ? { unavailable: classLock } : {}),
            },
          ],
        },
        {
          label: "ARAL Program",
          items: [
            {
              id: "teacher-aral-attendance",
              alsoOwns: /^\/teacher\/aral\/[^\/]+\/(learners\/[^\/]+\/)?attendance(\/|$)/,
              label: "Weekly Attendance",
              href: aralAttendanceNavHref(grades),
              icon: CalendarDays,
            },
            {
              id: "teacher-aral-reading-level",
              alsoOwns: /^\/teacher\/aral\/[^\/]+\/(learners\/[^\/]+\/)?reading-level(\/|$)/,
              label: "Monthly Reading Level",
              href: aralHref(grades, "reading-level"),
              icon: BookOpen,
            },
            // One page for every ARAL learner of this ARAL tutor, across grades,
            // so it is never grade-scoped and never collapses onto the picker.
            // Longest-prefix matching still awards it over `/teacher/aral`.
            {
              id: "teacher-aral-profiling",
              alsoOwns: /^\/teacher\/aral\/[^\/]+\/learners\/[^\/]+\/update(\/|$)/,
              label: "ARAL Profiling",
              href: ARAL_PROFILING_HREF,
              icon: ClipboardList,
            },
          ],
        },
        {
          label: "Analytics",
          items: [{ id: "teacher-reports", label: "Reports", href: "/teacher/reports", icon: FileBarChart }],
        },
      ];
      // A Non-DepEd ARAL Volunteer tutors ARAL learners and nothing else: no
      // advisory, no BOSY/MOSY, no advisory reports. Their menu is Dashboard and
      // ARAL Program. The advisory pages refuse them on the same condition
      // (`advisoryRosterDenial`); Reports, reachable by URL, keeps its own locks.
      return options.isAralVolunteer
        ? groups.filter((g) => g.label !== "Advisory" && g.label !== "Analytics")
        : groups;
    }
    case "DISTRICT_ADMIN":
      return [
        {
          // No heading: Dashboard sits on its own above the groups.
          items: [
            { id: "district-dashboard", label: "Dashboard", href: DISTRICT_ROUTES.home, icon: LayoutDashboard },
          ],
        },
        {
          // Mirrors the division's Management group, inside the admin's districts.
          label: "Management",
          items: [
            { id: "district-schools", label: "Schools", href: DISTRICT_ROUTES.schools, icon: School },
            { id: "district-learners", label: "Learners", href: DISTRICT_ROUTES.learners, icon: GraduationCap },
            { id: "district-teachers", label: "Teachers", href: DISTRICT_ROUTES.teachers, icon: Users },
            { id: "district-ip-learners", label: "IP Learners", href: DISTRICT_ROUTES.ipLearners, icon: Feather },
          ],
        },
        {
          // One row, like the division's Monitoring → Division Summary: the
          // summary index lists every facet, so the sidebar does not.
          label: "Monitoring",
          items: [
            { id: "district-summary", label: "District Summary", href: DISTRICT_ROUTES.summaryIndex, icon: BarChart3 },
          ],
        },
        {
          label: "Operations",
          items: [
            { id: "district-announcements", label: "Announcements", href: DISTRICT_ROUTES.announcements, icon: Megaphone },
            { id: "district-transfers", label: "Transfers", href: DISTRICT_ROUTES.transfers, icon: ArrowRightLeft },
            { id: "district-deleted-learners", label: "Deleted learners", href: DISTRICT_ROUTES.deletedLearners, icon: UserX, heavy: true },
            { id: "district-unlocks", label: "Revision access", href: DISTRICT_ROUTES.unlocks, icon: Unlock },
            { id: "district-support", label: "Support", href: DISTRICT_ROUTES.support, icon: LifeBuoy },
          ],
        },
        // Settings lives in the account menu (avatar), not the side menu.
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
  let bestIsClaimed = false;
  for (const item of navigable(items)) {
    // A deliberate claim (`alsoOwns`) beats any prefix match, however long.
    if (item.alsoOwns?.test(pathname)) {
      if (!bestIsClaimed || item.href.length > (best?.length ?? 0)) {
        best = item.href;
        bestIsClaimed = true;
      }
      continue;
    }
    if (bestIsClaimed) continue;
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
