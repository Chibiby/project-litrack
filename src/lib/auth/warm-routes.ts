import "server-only";
import {
  getAdminActivitySeries,
  getAdminMetricCounts,
  getAdminRecentSchools,
  getSchoolHeadCharts,
  getSchoolHeadMetricCounts,
  getSchoolHeadRecentActivity,
  getTeacherShellGrades,
} from "@/lib/dashboard/aggregates";
import { getTeacherOverview } from "@/lib/dashboard/teacher-overview";

/**
 * Server-side warming of a role's landing-page queries, run at login before
 * the redirect so the first render reads warm `unstable_cache` entries
 * instead of hitting Postgres.
 *
 * Two properties matter more than the speedup:
 *
 * 1. Warming must never fail a login. Every warmer is wrapped in
 *    `Promise.allSettled`, so a rejection is recorded, not thrown.
 * 2. Warming must never *hang* a login. `allSettled` waits forever on a
 *    pending promise, so each warmer also races a timeout — otherwise one
 *    stuck query would block sign-in indefinitely.
 */

/** Upper bound on total added login latency. */
const WARM_TIMEOUT_MS = 600;

/** Resolve `p`, or resolve anyway once `ms` elapses. Never rejects. */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);

    void p
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function warmAll(
  warmers: ReadonlyArray<() => Promise<unknown>>
): Promise<void> {
  await Promise.allSettled(
    warmers.map((w) => {
      // Call inside the map so a synchronous throw becomes a rejection
      // instead of escaping into the login action.
      try {
        return bounded(w(), WARM_TIMEOUT_MS);
      } catch {
        return Promise.resolve(null);
      }
    })
  );
}

/**
 * Warm a teacher's dashboard. Skip for PENDING teachers — they land on
 * /pending-approval and never see this data.
 *
 * These are the same leaf fetchers the dashboard calls, with the same
 * arguments, so they populate the exact `unstable_cache` entries the first
 * render will read. Warming the deprecated composed helpers instead would work
 * only by accident, and would put every leaf on one shared timeout budget.
 *
 * `getTeacherOverview` is one entry rather than three because the whole dashboard
 * now renders from a single snapshot — warming it also warms the header's
 * notification bell, which reads the same key from the teacher layout.
 */
export async function warmTeacherRoutes(opts: {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
}): Promise<void> {
  await warmAll([
    () => getTeacherShellGrades(opts),
    () => getTeacherOverview(opts),
  ]);
}

export async function warmSchoolHeadRoutes(schoolId: string): Promise<void> {
  await warmAll([
    () => getSchoolHeadMetricCounts(schoolId),
    () => getSchoolHeadCharts(schoolId),
    () => getSchoolHeadRecentActivity(schoolId),
  ]);
}

export async function warmAdminRoutes(): Promise<void> {
  await warmAll([
    () => getAdminMetricCounts(),
    () => getAdminActivitySeries(),
    () => getAdminRecentSchools(),
  ]);
}
