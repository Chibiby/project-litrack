import "server-only";
import type { User } from "@prisma/client";
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
import { loadAdminScopeForUser } from "@/lib/auth/district-scope";
import { resolveSummaryScope } from "@/lib/auth/admin-scope";
import { isDemoVisible } from "@/lib/demo/session";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getDistrictNotifications } from "@/lib/district/notifications";
import { SUMMARY_FACETS } from "@/lib/summary/facets";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";
import { monthKeyOf } from "@/lib/summary/shape/months";

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
    // Only half of this one warms anything. `getSchoolHeadRecentActivity` now
    // runs its `auditLog.findMany` outside `cachedQuery` — deliberately, because
    // that rail has no invalidation path — so the warm performs one read whose
    // result is discarded, and only the announcements / pending-ARAL-profile half
    // reaches the Data Cache. Accepted rather than restructured: the discarded
    // read is eight rows straight off `@@index([schoolId, timestamp])` with no
    // joins, it is already inside the `WARM_TIMEOUT_MS` budget, and warming the
    // cached half alone would mean exporting it separately and giving this
    // aggregate a second entry point to keep in step.
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

/**
 * Warm a district admin's `/district` overview.
 *
 * Deliberately NOT `warmAdminRoutes`: those are division-wide aggregates a
 * district admin never reads. Each leaf here is called with the exact
 * arguments `src/app/district/page.tsx` uses, so it fills the same
 * `scopeCacheKey`-keyed entries the first render reads instead of a
 * differently-keyed one nobody hits.
 *
 * Takes the just-authenticated `User` row directly rather than going through
 * `requireAdminScope()` / `requireUser()`: this runs from the login action,
 * before the redirect, while the Supabase session cookie the request needs is
 * still only just being written — `loadAdminScopeForUser` resolves the same
 * scope from the row the caller already has, with no second round trip
 * through `getCurrentUser`.
 */
export async function warmDistrictRoutes(user: Pick<User, "id" | "role">): Promise<void> {
  // The setup below runs outside `warmAll`, so it carries its own guard: a
  // throw here must cost the warm, never the sign-in.
  try {
    await warmDistrictOverview(user);
  } catch {
    // Warming is best-effort; the page loads the same data on first render.
  }
}

async function warmDistrictOverview(user: Pick<User, "id" | "role">): Promise<void> {
  const scope = await loadAdminScopeForUser(user).catch(() => null);
  if (!scope) return;
  // A district admin with no assignments sees `NoDistrictsState`, not the
  // dashboard tiles — nothing to warm.
  if (scope.kind === "districts" && scope.districts.length === 0) return;

  const demoVisible = await isDemoVisible();
  const summaryScope = resolveSummaryScope(scope, {});
  const month = monthKeyOf(formatLocalDateKey(schoolToday()));

  await warmAll([
    () => resolveScopeSchools(scope, demoVisible),
    () => SUMMARY_FACETS.learners.load(summaryScope, { level: "overall" }),
    () =>
      SUMMARY_FACETS["reading-behavior"].load(summaryScope, { level: "overall", month }),
    () =>
      SUMMARY_FACETS.attendance.load(summaryScope, {
        level: "overall",
        from: month,
        to: month,
      }),
    () => SUMMARY_FACETS.compliance.load(summaryScope, { level: "overall" }),
    () => getDistrictNotifications(user, scope),
  ]);
}
