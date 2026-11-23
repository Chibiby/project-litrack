/**
 * Weekly Attendance across every grade a teacher works in, at once.
 *
 * The per-grade page (`/teacher/aral/[gradeId]/attendance`) stays the page for
 * one grade; this view is its default whenever the grade picker would offer a
 * choice. Pure helpers only, so the page, the fetch action and the panel share
 * one definition and tests can reach it without a database.
 */

/** The all-grades Weekly Attendance page. */
export const ALL_GRADES_ATTENDANCE_PATH = "/teacher/aral/attendance";

/** The grade picker's value for "every grade", never a real grade id. */
export const ALL_GRADES_VALUE = "all";

/** The picker's label for that option. */
export const ALL_GRADES_LABEL = "All grades";

/**
 * Days that are a holiday in every grade on screen. Only these lock the whole
 * column; a holiday that only some grades keep locks just those grades' rows.
 * With no grades on screen nothing is common, so nothing locks.
 */
export function commonHolidayKeys(
  holidayKeysByGrade: Record<string, string[]>,
  gradeIds: Iterable<string>
): string[] {
  const ids = [...new Set(gradeIds)];
  if (ids.length === 0) return [];
  const [first, ...rest] = ids;
  const sets = rest.map((id) => new Set(holidayKeysByGrade[id] ?? []));
  return (holidayKeysByGrade[first] ?? []).filter((key) =>
    sets.every((set) => set.has(key))
  );
}

/**
 * What the Section column reads in the all-grades view: the grade first, so
 * rows from different grades never share a label, then the section if any.
 */
export function gradeSectionLabel(
  gradeLabel: string,
  sectionName: string | null
): string {
  return sectionName ? `${gradeLabel} · ${sectionName}` : gradeLabel;
}
