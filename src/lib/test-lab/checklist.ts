/**
 * Page Test Lab checklist (docs/test-lab-spec.md, T3).
 *
 * Pure and client-safe: no Prisma, no `server-only`, so both the
 * `/admin/test-lab` server page and its client checklist component can build
 * the same list. `buildTestLabChecklist` needs concrete fixture ids because
 * every School Head and Teacher page below is dynamic and would otherwise
 * 404 or bounce a Super Admin who has no advisory/roster of their own.
 *
 * Coverage is enforced by `tests/unit/test-lab-checklist.test.ts`, which walks
 * every `page.tsx` under `src/app/school-head` and `src/app/teacher` and
 * requires it to appear here or in `ALIASES` (or be an excluded
 * `[...missing]`/`error`/`loading` file).
 */

import { SUMMARY_FACET_LIST } from "@/lib/summary/facet-meta";
import { TEST_LAB_SET_PASSWORD_PATH, type TestLabPersona } from "@/lib/test-lab/personas";

export type TestLabChecklistFixtures = {
  /** One demo section's grade, e.g. Grade 1-A's `gradeLevelId`. */
  gradeId: string;
  /** A second demo grade (Kindergarten), for pages a single-grade fixture can't reach twice. */
  secondGradeId: string;
  /** A regular (non-ARAL) learner inside `gradeId`'s roster. */
  learnerId: string;
  /** An ARAL learner inside `gradeId`'s roster, `aralTeacherId` = the demo teacher. */
  aralLearnerId: string;
  /** The demo school, for the district portal's school page. */
  schoolId: string;
};

export type TestLabChecklistItem = {
  id: string;
  role: "SCHOOL_HEAD" | "TEACHER" | "DISTRICT_ADMIN";
  group: string;
  label: string;
  href: string;
  /**
   * Who opens the row. Defaults to the role's main persona (the head, the
   * multi-advisory teacher, the demo district admin); set for pages only one
   * kind of account reaches, such as the first-run profiling wizard.
   */
  persona?: TestLabPersona;
};

/** The persona a row opens as. */
export function checklistItemPersona(item: TestLabChecklistItem): TestLabPersona {
  if (item.persona) return item.persona;
  if (item.role === "SCHOOL_HEAD") return "head";
  if (item.role === "DISTRICT_ADMIN") return "district";
  return "teacher";
}

/**
 * Routes that exist only to redirect (legacy bookmarks, descriptive aliases).
 * Opening one always lands on a page already covered above, so Test Lab does
 * not offer them as separate checklist rows, but the coverage test still
 * requires every `page.tsx` to be accounted for somewhere.
 */
export const ALIASES: string[] = [
  // Redirects to Monitoring > Non-compliance.
  "/school-head/monitoring",
  "/school-head/grade-levels",
  "/school-head/school-years",
  "/school-head/school-info",
  "/school-head/sections",
  "/school-head/transfer",
  "/school-head/school/grade-levels",
  "/school-head/school/info",
  "/school-head/school/years",
  "/school-head/profile",
  "/school-head/password",
  "/school-head/settings",
  "/teacher/profile",
  "/teacher/password",
  "/teacher/settings",
  "/district/settings",
];

export function buildTestLabChecklist(fixtures: TestLabChecklistFixtures): TestLabChecklistItem[] {
  const { gradeId, secondGradeId, learnerId, aralLearnerId, schoolId } = fixtures;

  const schoolHead: TestLabChecklistItem[] = [
    { id: "sh-dashboard", role: "SCHOOL_HEAD", group: "Dashboard", label: "Dashboard", href: "/school-head" },
    { id: "sh-announcements", role: "SCHOOL_HEAD", group: "Dashboard", label: "Announcements", href: "/school-head/announcements" },
    { id: "sh-aral", role: "SCHOOL_HEAD", group: "ARAL", label: "ARAL", href: "/school-head/aral" },
    { id: "sh-audit", role: "SCHOOL_HEAD", group: "Dashboard", label: "Audit log", href: "/school-head/audit" },
    { id: "sh-grade-levels", role: "SCHOOL_HEAD", group: "School", label: "Grade and Section", href: "/school-head/school" },
    { id: "sh-school-years", role: "SCHOOL_HEAD", group: "School", label: "School Year", href: "/school-head/school/years" },
    { id: "sh-school-info", role: "SCHOOL_HEAD", group: "School", label: "Overview", href: "/school-head/school/info" },
    { id: "sh-ip-learners", role: "SCHOOL_HEAD", group: "Reports", label: "IP learners", href: "/school-head/ip-learners" },
    { id: "sh-reports", role: "SCHOOL_HEAD", group: "Reports", label: "Reports", href: "/school-head/reports" },
    { id: "sh-term-subjects", role: "SCHOOL_HEAD", group: "Reports", label: "Term subjects", href: "/school-head/term-subjects" },
    { id: "sh-kinder-checklist", role: "SCHOOL_HEAD", group: "Reports", label: "Kindergarten checklist", href: "/school-head/terms-reports/kinder" },
    { id: "sh-learners", role: "SCHOOL_HEAD", group: "Management", label: "Learners", href: "/school-head/learners" },
    { id: "sh-aral-teachers", role: "SCHOOL_HEAD", group: "Management", label: "ARAL tutors", href: "/school-head/aral-teachers" },
    { id: "sh-monitoring-non-compliance", role: "SCHOOL_HEAD", group: "Monitoring", label: "Non-compliance", href: "/school-head/monitoring/non-compliance" },
    { id: "sh-monitoring-aral", role: "SCHOOL_HEAD", group: "Monitoring", label: "ARAL Monitoring", href: "/school-head/monitoring/aral" },
    { id: "sh-monitoring-discrepancies", role: "SCHOOL_HEAD", group: "Monitoring", label: "Discrepancies", href: "/school-head/monitoring/discrepancies" },
    { id: "sh-teachers", role: "SCHOOL_HEAD", group: "Teachers", label: "Teachers (active)", href: "/school-head/teachers" },
    { id: "sh-teachers-pending", role: "SCHOOL_HEAD", group: "Teachers", label: "Teachers (pending)", href: "/school-head/teachers/pending" },
    { id: "sh-teachers-inactive", role: "SCHOOL_HEAD", group: "Teachers", label: "Teachers (inactive)", href: "/school-head/teachers/inactive" },
    { id: "sh-teachers-declined", role: "SCHOOL_HEAD", group: "Teachers", label: "Teachers (declined)", href: "/school-head/teachers/declined" },
    { id: "sh-teachers-removed", role: "SCHOOL_HEAD", group: "Teachers", label: "Teachers (removed)", href: "/school-head/teachers/removed" },
    { id: "sh-settings-profile", role: "SCHOOL_HEAD", group: "Settings", label: "Profile", href: "/school-head/settings/profile" },
    { id: "sh-settings-security", role: "SCHOOL_HEAD", group: "Settings", label: "Security", href: "/school-head/settings/security" },
    { id: "sh-profiling", role: "SCHOOL_HEAD", group: "Onboarding", label: "Profiling wizard", href: "/school-head/profiling" },
    { id: "sh-set-password", role: "SCHOOL_HEAD", group: "Onboarding", label: "First sign-in: set a password", href: TEST_LAB_SET_PASSWORD_PATH },
  ];

  const teacher: TestLabChecklistItem[] = [
    { id: "t-dashboard", role: "TEACHER", group: "Dashboard", label: "Dashboard", href: "/teacher" },
    { id: "t-aral", role: "TEACHER", group: "ARAL", label: "ARAL", href: "/teacher/aral" },
    { id: "t-aral-profiling", role: "TEACHER", group: "ARAL", label: "ARAL profiling", href: "/teacher/aral/profiling" },
    { id: "t-aral-bosy", role: "TEACHER", group: "ARAL", label: "BOSY report", href: "/teacher/aral/bosy" },
    { id: "t-aral-mosy", role: "TEACHER", group: "ARAL", label: "MOSY report", href: "/teacher/aral/mosy" },
    { id: "t-aral-attendance-all", role: "TEACHER", group: "ARAL", label: "ARAL weekly attendance, all grades", href: "/teacher/aral/attendance" },
    { id: "t-aral-attendance", role: "TEACHER", group: "ARAL", label: "ARAL weekly attendance", href: `/teacher/aral/${gradeId}/attendance` },
    { id: "t-aral-reading-level", role: "TEACHER", group: "ARAL", label: "ARAL reading level", href: `/teacher/aral/${gradeId}/reading-level` },
    { id: "t-aral-terms-reports", role: "TEACHER", group: "ARAL", label: "ARAL term reports", href: `/teacher/aral/${gradeId}/terms-reports` },
    { id: "t-aral-learner-attendance", role: "TEACHER", group: "ARAL", label: "ARAL learner attendance", href: `/teacher/aral/${gradeId}/learners/${aralLearnerId}/attendance` },
    { id: "t-aral-learner-reading-level", role: "TEACHER", group: "ARAL", label: "ARAL learner reading level", href: `/teacher/aral/${gradeId}/learners/${aralLearnerId}/reading-level` },
    { id: "t-aral-learner-update", role: "TEACHER", group: "ARAL", label: "ARAL learner profile update", href: `/teacher/aral/${gradeId}/learners/${aralLearnerId}/update` },
    { id: "t-grade", role: "TEACHER", group: "Advisory", label: "Grade roster", href: `/teacher/grade/${gradeId}` },
    { id: "t-grade-second", role: "TEACHER", group: "Advisory", label: "Second advisory grade", href: `/teacher/grade/${secondGradeId}` },
    { id: "t-grade-import", role: "TEACHER", group: "Advisory", label: "Import learners", href: `/teacher/grade/${gradeId}/import` },
    { id: "t-learner", role: "TEACHER", group: "Advisory", label: "Learner profile", href: `/teacher/grade/${gradeId}/learners/${learnerId}` },
    { id: "t-learner-edit", role: "TEACHER", group: "Advisory", label: "Edit learner", href: `/teacher/grade/${gradeId}/learners/${learnerId}/edit` },
    { id: "t-learners", role: "TEACHER", group: "Advisory", label: "All learners", href: "/teacher/learners" },
    { id: "t-reports", role: "TEACHER", group: "Reports", label: "Reports", href: "/teacher/reports" },
    { id: "t-terms-reports", role: "TEACHER", group: "Reports", label: "Term reports", href: "/teacher/terms-reports" },
    { id: "t-terms-reports-kinder", role: "TEACHER", group: "Reports", label: "Kindergarten term report", href: "/teacher/terms-reports/kinder" },
    { id: "t-settings-profile", role: "TEACHER", group: "Settings", label: "Profile", href: "/teacher/settings/profile" },
    { id: "t-settings-security", role: "TEACHER", group: "Settings", label: "Security", href: "/teacher/settings/security" },
    { id: "t-profiling", role: "TEACHER", group: "Onboarding", label: "Profiling wizard", href: "/teacher/profiling" },
    { id: "t-profiling-first-run", role: "TEACHER", group: "Onboarding", label: "Profiling, first sign-in after approval", href: "/teacher/profiling", persona: "teacher-unprofiled" },
    { id: "t-profiling-volunteer", role: "TEACHER", group: "Onboarding", label: "Profiling, Non-DepEd ARAL Volunteer", href: "/teacher/profiling", persona: "volunteer-unprofiled" },
    { id: "t-set-password", role: "TEACHER", group: "Onboarding", label: "First sign-in: set a password", href: TEST_LAB_SET_PASSWORD_PATH },
    { id: "t-pending-approval", role: "TEACHER", group: "Onboarding", label: "Waiting for approval", href: "/teacher", persona: "pending-teacher" },
  ];

  const district: TestLabChecklistItem[] = [
    { id: "d-dashboard", role: "DISTRICT_ADMIN", group: "Dashboard", label: "Dashboard", href: "/district" },
    { id: "d-announcements", role: "DISTRICT_ADMIN", group: "Dashboard", label: "Announcements", href: "/district/announcements" },
    { id: "d-support", role: "DISTRICT_ADMIN", group: "Dashboard", label: "Support", href: "/district/support" },
    { id: "d-schools", role: "DISTRICT_ADMIN", group: "Schools", label: "Schools", href: "/district/schools" },
    { id: "d-school", role: "DISTRICT_ADMIN", group: "Schools", label: "School page", href: `/district/schools/${schoolId}` },
    { id: "d-learners", role: "DISTRICT_ADMIN", group: "People", label: "Learners", href: "/district/learners" },
    { id: "d-ip-learners", role: "DISTRICT_ADMIN", group: "People", label: "IP learners", href: "/district/ip-learners" },
    { id: "d-deleted-learners", role: "DISTRICT_ADMIN", group: "People", label: "Deleted learners", href: "/district/deleted-learners" },
    { id: "d-teachers", role: "DISTRICT_ADMIN", group: "People", label: "Teachers", href: "/district/teachers" },
    { id: "d-transfers", role: "DISTRICT_ADMIN", group: "Requests", label: "Transfers", href: "/district/transfers" },
    { id: "d-unlocks", role: "DISTRICT_ADMIN", group: "Requests", label: "Unlocks", href: "/district/unlocks" },
    { id: "d-summary", role: "DISTRICT_ADMIN", group: "Summary", label: "Summary", href: "/district/summary" },
    ...SUMMARY_FACET_LIST.map(
      (facet): TestLabChecklistItem => ({
        id: `d-summary-${facet.id}`,
        role: "DISTRICT_ADMIN",
        group: "Summary",
        label: `Summary: ${facet.label}`,
        href: `/district/summary/${facet.id}`,
      })
    ),
    { id: "d-settings-profile", role: "DISTRICT_ADMIN", group: "Settings", label: "Profile", href: "/district/settings/profile" },
    { id: "d-settings-security", role: "DISTRICT_ADMIN", group: "Settings", label: "Security", href: "/district/settings/security" },
  ];

  return [...schoolHead, ...teacher, ...district];
}
