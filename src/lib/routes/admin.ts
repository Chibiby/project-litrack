/**
 * Single source of truth for Super Admin (Division Admin and Developer Admin)
 * route paths.
 *
 * Same reasoning as `src/lib/routes/school-head.ts`: these strings appear in
 * the sidebar nav config, dashboard CTAs, in-page links, the prefetch warmer,
 * and `revalidatePath` calls, so a route move is a one-file edit `tsc`
 * propagates. A `revalidatePath` string that drifts from its route fails
 * silently.
 *
 * The paths are nested by sidebar section — Management, School Setup,
 * Monitoring — so the URL tells the admin where they are. The
 * pre-restructure URLs survive as redirects (see `LEGACY_ADMIN_REDIRECTS`).
 *
 * Plain constants and pure functions with no imports, so this is safe in Edge
 * middleware, server actions, and client components alike.
 */
export const ADMIN_ROUTES = {
  home: "/admin",

  // Management
  learners: "/admin/management/learners",
  teachers: "/admin/management/teachers",
  aralTutors: "/admin/management/aral-tutors",
  schoolHeads: "/admin/management/school-heads",
  schools: "/admin/management/schools",
  newSchool: "/admin/management/schools/new",
  school: (schoolId: string) => `/admin/management/schools/${schoolId}`,
  districtAdmins: "/admin/management/district-admins",

  // School Setup
  schoolYears: "/admin/school-setup/school-years",
  termSubjects: "/admin/school-setup/term-subjects",
  reportSubmissions: "/admin/school-setup/report-submissions",
  learnerTransfers: "/admin/school-setup/learner-transfers",

  // Monitoring
  divisionSummary: "/admin/monitoring/division-summary",
  divisionSummaryFacet: (facet: string) => `/admin/monitoring/division-summary/${facet}`,
  support: "/admin/monitoring/support",

  // Developer Controls (Developer Admin only) — unchanged paths.
  audit: "/admin/audit",
  errors: "/admin/errors",
  testLab: "/admin/test-lab",
  archive: "/admin/archive",
  database: "/admin/database",
  adminAccounts: "/admin/admin-accounts",

  // Account pages — unchanged paths.
  profile: "/admin/profile",
  settings: "/admin/settings",
  chat: "/admin/chat",
} as const;

/**
 * Pre-restructure path → new path. Each old page file becomes a `redirect()`
 * to its entry here, carrying the query string across so bookmarked filters
 * survive. Nested paths (`/admin/schools/<id>`) map by prefix.
 */
export const LEGACY_ADMIN_REDIRECTS: Readonly<Record<string, string>> = {
  "/admin/schools": ADMIN_ROUTES.schools,
  "/admin/accounts": ADMIN_ROUTES.teachers,
  "/admin/school-accounts": ADMIN_ROUTES.schoolHeads,
  "/admin/ip-learners": ADMIN_ROUTES.learners,
  "/admin/school-years": ADMIN_ROUTES.schoolYears,
  "/admin/term-subjects": ADMIN_ROUTES.termSubjects,
  "/admin/submissions": ADMIN_ROUTES.reportSubmissions,
  "/admin/settings/submissions": ADMIN_ROUTES.reportSubmissions,
  "/admin/transfers": ADMIN_ROUTES.learnerTransfers,
  "/admin/summary": ADMIN_ROUTES.divisionSummary,
  "/admin/support": ADMIN_ROUTES.support,
};

/** Search params as a page receives them (`await props.searchParams`). */
export type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * `path` with `params` appended as a query string, repeated keys kept, the
 * `omit` keys dropped. Legacy redirect pages use it so a bookmarked filter
 * survives the move.
 */
export function withSearchParams(
  path: string,
  params: PageSearchParams,
  omit: readonly string[] = []
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || omit.includes(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Where a legacy `/admin/accounts?role=` link lands now that each role has its own page. */
export function accountsRoleRoute(role: string | string[] | undefined): string {
  const value = Array.isArray(role) ? role[0] : role;
  if (value === "SCHOOL_HEAD") return ADMIN_ROUTES.schoolHeads;
  if (value === "DISTRICT_ADMIN") return ADMIN_ROUTES.districtAdmins;
  return ADMIN_ROUTES.teachers;
}
