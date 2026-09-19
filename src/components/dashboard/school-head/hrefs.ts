import { schoolHeadHref, type SchoolHeadView } from "@/components/school-head/school-head-page";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Deep links out of the School Head dashboard. Mirrors
 * `src/components/dashboard/teacher/hrefs.ts`: every target is a named
 * function here so no component concatenates a path, and every one goes
 * through `schoolHeadHref` so a Super Admin's `?schoolId=` drill-down
 * survives the click (`docs/school-head-ui-rework.md` section 3.4).
 */

/** Learners card, and the coverage panel's "View IP learners" pill. */
export function ipLearnersHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.ipLearners);
}

/** Teachers card, and "Manage teachers" quick action. */
export function teachersHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.teachers);
}

/** Pending approvals card, and the "approvals" attention item. */
export function teachersPendingHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.teachersPending);
}

/**
 * Grade levels and Sections cards, and the "adviserless" attention item.
 * Deliberately the same target as `SCHOOL_HEAD_ROUTES.schoolGradeLevels`:
 * sections live on the grade levels tab, not a route of their own.
 */
export function schoolGradeLevelsHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.schoolGradeLevels);
}

/** ARAL learners card, and the coverage panel's "Designate ARAL teachers" pill. */
export function aralHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.aral);
}

/** The "year" attention item, when no school year is active. */
export function schoolYearsHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.schoolYears);
}

/** The "setup:profile" attention item, when the head has not yet profiled. */
export function profilingHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.profiling);
}

/** "Post an announcement" quick action. */
export function announcementsHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.announcements);
}

/** "Transfer a learner" quick action. */
export function transferHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.transfer);
}

/** "Generate a report" quick action. */
export function reportsHref(view: SchoolHeadView): string {
  return schoolHeadHref(view, SCHOOL_HEAD_ROUTES.reports);
}
