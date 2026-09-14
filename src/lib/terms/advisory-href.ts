/**
 * The URL of one advisory's End of Terms sheet.
 *
 * Grade in the path because the page is grade-scoped; section in the query
 * because multi-advisory lets one teacher hold several sections inside a single
 * grade, and the grade alone would then name two sheets. Carrying the section
 * makes the link mean exactly one roster — and a bookmark of it keeps meaning
 * the same one after the teacher picks up a second section in that grade.
 *
 * Shared between the chooser at `/teacher/terms-reports` and the sheet's own
 * in-page picker so the two cannot build the link differently. No `?schoolId=`:
 * a Super Admin never reaches these, because they advise nothing.
 */
export function termSheetHref(
  placement: { gradeLevelId: string; sectionId: string },
  extraParams?: Record<string, string | undefined>
): string {
  const params = new URLSearchParams({ section: placement.sectionId });
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/teacher/aral/${placement.gradeLevelId}/terms-reports?${params.toString()}`;
}
