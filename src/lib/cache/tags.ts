/**
 * Cache tag helpers for Next.js `unstable_cache` / `revalidateTag`.
 * Tag strings only — request-level React `cache()` lives in consumers;
 * cross-request TTL wiring uses `cachedQuery` in `@/lib/cache/unstable`.
 */

/**
 * Carried by every `cachedQuery` entry. Only for operations that replace data
 * wholesale across tenants — a database restore, undo, or reset — where no
 * narrower tag names everything that changed.
 */
export const allCachedData = "litrack-data";

export const adminDashboard = "admin-dashboard";

export const schoolsList = "schools-list";

/**
 * Every cached summary facet (`src/lib/summary/**`), at every scope.
 *
 * Global rather than per-district: summary data is refreshed on a short TTL, and
 * the only mutations that bust it explicitly are school-level ones (a school
 * created, archived, moved between districts, or flagged demo) that change which
 * schools a scope covers.
 */
export const divisionSummary = "division-summary";

export function schoolDashboard(schoolId: string): string {
  return `school-dashboard:${schoolId}`;
}

export function teacherDashboard(userId: string): string {
  return `teacher-dashboard:${userId}`;
}

export function teacherShell(userId: string): string {
  return `teacher-shell:${userId}`;
}

export function schoolName(schoolId: string): string {
  return `school-name:${schoolId}`;
}

/**
 * One school's teacher roster, as every picker and list reads it.
 *
 * Tenant-scoped by construction: a teacher list is school data, so this takes a
 * `schoolId` like every other non-global tag here. An unscoped
 * `"school-teachers"` string would make one school's teacher mutation flush
 * every other school's entry.
 */
export function schoolTeachers(schoolId: string): string {
  return `school-teachers:${schoolId}`;
}

/**
 * The division admin's support inbox.
 *
 * Global rather than school-scoped, unlike every tenant tag above: the inbox is
 * a deliberately cross-tenant queue, the same shape as the Super Admin audit
 * view. A ticket from any school busts it.
 */
export const supportInbox = "support-inbox";

/** One person's own tickets, as the assistant panel lists them. */
export function userSupportTickets(userId: string): string {
  return `support-tickets:${userId}`;
}
