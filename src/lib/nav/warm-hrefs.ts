import type { UserRole } from "@prisma/client";
import {
  roleHomePath,
  roleSettingsProfilePath,
  roleSecurityPath,
} from "@/lib/auth/roles";

/**
 * Cheap shell destinations for NavPrefetcher FULL warm.
 * Dashboard / settings profile + security only — reports, grade rosters, and
 * other heavy sidebar routes stay on default Link prefetch (loading.tsx skeleton).
 */
export function getShellWarmHrefs(role: UserRole): string[] {
  const home = roleHomePath(role);
  const profile = roleSettingsProfilePath(role);
  const security = roleSecurityPath(role);
  switch (role) {
    case "TEACHER":
    case "SUPER_ADMIN":
    case "SCHOOL_HEAD":
      return [home, profile, security];
    default:
      return [security];
  }
}

/**
 * Cap mass learner warm lists. Full-prefetching every roster row re-runs
 * force-dynamic teacher layout/auth and saturates the Prisma pool.
 */
const MAX_NESTED_LEARNER_WARMS = 2;

/** Learner view/edit (+ import) hrefs for the visible grade roster page. */
export function getGradeLearnerWarmHrefs(
  gradeId: string,
  learners: readonly { id: string; archivedAt?: Date | string | null }[]
): string[] {
  const hrefs: string[] = [
    `/teacher/learners?grade=${gradeId}`,
    `/teacher/grade/${gradeId}/import`,
  ];
  for (const learner of learners.slice(0, MAX_NESTED_LEARNER_WARMS)) {
    const base = `/teacher/grade/${gradeId}/learners/${learner.id}`;
    hrefs.push(base);
    if (!learner.archivedAt) {
      hrefs.push(`${base}/edit`);
    }
  }
  return hrefs;
}

/** ARAL action hrefs for learners listed on the ARAL dashboard (capped). */
export function getAralLearnerWarmHrefs(
  gradeId: string,
  learnerIds: readonly string[]
): string[] {
  // Warm only the primary Update Data action per learner — attendance /
  // reading-level stay on demand to avoid nested force-dynamic storms.
  return [
    `/teacher/aral?grade=${gradeId}`,
    ...learnerIds
      .slice(0, MAX_NESTED_LEARNER_WARMS)
      .map((id) => `/teacher/aral/${gradeId}/learners/${id}/update`),
  ];
}

/**
 * Sibling destinations from a learner detail/edit page.
 * Keep this narrow: roster back + edit only (ARAL actions are one click away).
 */
export function getLearnerDetailWarmHrefs(
  gradeId: string,
  learner: { id: string; isAralLearner?: boolean; archivedAt?: Date | string | null }
): string[] {
  const hrefs: string[] = [`/teacher/learners?grade=${gradeId}`];
  if (!learner.archivedAt) {
    hrefs.push(`/teacher/grade/${gradeId}/learners/${learner.id}/edit`);
  }
  if (learner.isAralLearner) {
    hrefs.push(`/teacher/aral?grade=${gradeId}`);
  }
  return hrefs;
}

/**
 * Back destinations from an ARAL learner subpage.
 * Do not warm every sibling ARAL action — each is force-dynamic.
 */
export function getAralActionWarmHrefs(gradeId: string, learnerId: string): string[] {
  return [
    `/teacher/aral?grade=${gradeId}`,
    `/teacher/grade/${gradeId}/learners/${learnerId}`,
  ];
}
