/**
 * Single source of truth for District Admin route paths.
 *
 * Same reasoning as `src/lib/routes/school-head.ts`: these strings appear in
 * the sidebar nav config, the header search target, the post-login prefetch
 * warmer, and page-level links, so centralising them makes a route move a
 * one-file edit `tsc` propagates.
 *
 * Plain string constants (and pure functions for the two id-parameterised
 * routes) with no imports, so this is safe to pull into Edge middleware,
 * server actions, and client components alike.
 */
export const DISTRICT_ROUTES = {
  home: "/district",

  schools: "/district/schools",
  /** A single in-scope school's detail page. */
  school: (schoolId: string) => `/district/schools/${schoolId}`,

  support: "/district/support",
  announcements: "/district/announcements",
  transfers: "/district/transfers",
  unlocks: "/district/unlocks",

  settings: "/district/settings",
  settingsProfile: "/district/settings/profile",
  settingsSecurity: "/district/settings/security",

  /** One district admin's view of a summary facet, e.g. `summary("learners")`. */
  summary: (facetId: DistrictSummaryFacetId) => `/district/summary/${facetId}`,
} as const;

/**
 * The summary facet registry's ids and labels, as far as routing and nav need
 * them. `src/lib/summary/facets.ts` (backend-owned) is the full registry with
 * loaders and export shaping; this constant exists so nav and route code do
 * not need to import that module just to list the seven facets.
 */
export const DISTRICT_SUMMARY_FACETS = [
  { id: "learners", label: "Learners" },
  { id: "reading-behavior", label: "Reading behavior" },
  { id: "end-of-term", label: "End of term" },
  { id: "attendance", label: "Attendance" },
  { id: "reading-levels", label: "Monthly reading level" },
  { id: "compliance", label: "Compliance" },
  { id: "profiling", label: "Teacher & head profiling" },
] as const;

export type DistrictSummaryFacetId = (typeof DISTRICT_SUMMARY_FACETS)[number]["id"];
