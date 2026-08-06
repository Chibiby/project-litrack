/**
 * Cache tag helpers for Next.js `unstable_cache` / `revalidateTag`.
 * Tag strings only — request-level React `cache()` lives in consumers;
 * cross-request TTL wiring uses `cachedQuery` in `@/lib/cache/unstable`.
 */

export const adminDashboard = "admin-dashboard";

export const schoolsList = "schools-list";

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
