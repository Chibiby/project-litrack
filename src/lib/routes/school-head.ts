/**
 * Single source of truth for School Head route paths.
 *
 * These strings appear in ~60 places: the sidebar nav config, in-page links,
 * dashboard aggregate CTAs, the post-login prefetch warmer, each page's own
 * `resolveSchoolContext` / pagination `basePath` argument, and 14
 * `revalidatePath` calls spread across seven server-action modules.
 *
 * A `revalidatePath` string that drifts from its route fails *silently* — no
 * exception, no failing test, just a page serving stale data. Centralising the
 * paths makes a route move a one-file edit that `tsc` propagates.
 *
 * Plain string constants with no imports, so this is safe to pull into Edge
 * middleware, server actions, and client components alike.
 */
export const SCHOOL_HEAD_ROUTES = {
  dashboard: "/school-head",

  /** Outside the `(app)` group: the first-run wizard has no sidebar. */
  profiling: "/school-head/profiling",

  /**
   * School setup workspace. Grade levels, school years and school info are one
   * job — configure the school — so they are tabs under one route rather than
   * three sidebar entries.
   */
  school: "/school-head/school",
  /**
   * Deliberately the same path as `school`: the workspace root *serves* the
   * grade-levels panel rather than redirecting to a child segment. A redirecting
   * root would cost a second round trip on the most-clicked sidebar item, and
   * pointing the sidebar at a child instead would lose the highlight on the
   * other two tabs (`resolveActiveHref` matches by prefix).
   *
   * The separate key keeps call sites honest about *what* they are busting, and
   * means only one line changes if grade levels ever gets its own segment.
   */
  schoolGradeLevels: "/school-head/school",
  schoolYears: "/school-head/school/years",
  schoolInfo: "/school-head/school/info",

  /**
   * Teachers workspace. The path is unchanged and Active remains the default
   * view, so every existing link and `revalidatePath("/school-head/teachers")`
   * still resolves; the other three states become child segments instead of
   * tables stacked below the fold.
   */
  teachers: "/school-head/teachers",
  teachersPending: "/school-head/teachers/pending",
  teachersInactive: "/school-head/teachers/inactive",
  teachersDeclined: "/school-head/teachers/declined",

  aral: "/school-head/aral",
  transfer: "/school-head/transfer",
  announcements: "/school-head/announcements",
  reports: "/school-head/reports",
  audit: "/school-head/audit",

  /** Settings workspace root — what the sidebar and the prefetch warmer target. */
  settings: "/school-head/settings",
  settingsProfile: "/school-head/settings/profile",
  settingsSecurity: "/school-head/settings/security",
} as const;

export type SchoolHeadRoute =
  (typeof SCHOOL_HEAD_ROUTES)[keyof typeof SCHOOL_HEAD_ROUTES];

/**
 * Paths that existed before the workspace restructure. Each one still resolves
 * to a `redirect()` stub that forwards to its replacement, preserving any
 * `?schoolId=` so a Super Admin's bookmark keeps its school context. Deleting a
 * stub 404s bookmarks and stale emails, so they stay.
 */
export const SCHOOL_HEAD_LEGACY_ROUTES = {
  "/school-head/school-years": SCHOOL_HEAD_ROUTES.schoolYears,
  "/school-head/grade-levels": SCHOOL_HEAD_ROUTES.schoolGradeLevels,
  "/school-head/school-info": SCHOOL_HEAD_ROUTES.schoolInfo,
  /** Soft-deprecated well before this restructure: sections live under grade levels. */
  "/school-head/sections": SCHOOL_HEAD_ROUTES.schoolGradeLevels,
} as const;
