/**
 * The URL of one advisory's End of Terms sheet.
 *
 * v2: the sheet lives at `/teacher/terms-reports` for every advisory, opening
 * on All Advisories; `?advisory=` narrows it to one section. The section, not
 * the grade, is what names one roster — multi-advisory lets a teacher hold
 * several sections inside a single grade.
 *
 * No `?schoolId=`: a Super Admin never reaches these, because they advise
 * nothing.
 */
export function termSheetHref(
  placement: { sectionId: string },
  extraParams?: Record<string, string | undefined>
): string {
  const params = new URLSearchParams({ advisory: placement.sectionId });
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/teacher/terms-reports?${params.toString()}`;
}

/**
 * Where the old grade-scoped URL (`/teacher/aral/[gradeId]/terms-reports`)
 * sends a teacher. `?section=` becomes `?advisory=`; with no section named, the
 * grade's only advisory is picked, and a grade holding several (or none of
 * theirs) opens All Advisories. `term`, `q`, `page` and `perPage` ride along
 * so a bookmark lands on the same view.
 */
export function legacyTermSheetRedirect(
  placements: readonly { sectionId: string; gradeLevelId: string }[],
  gradeId: string,
  params: Record<string, string | undefined>
): string {
  const inGrade = placements.filter((p) => p.gradeLevelId === gradeId);
  const named = params.section
    ? inGrade.find((p) => p.sectionId === params.section)
    : inGrade.length === 1
      ? inGrade[0]
      : undefined;
  const sp = new URLSearchParams();
  if (named) sp.set("advisory", named.sectionId);
  for (const key of ["term", "q", "page", "perPage"] as const) {
    const value = params[key];
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `/teacher/terms-reports?${qs}` : "/teacher/terms-reports";
}
