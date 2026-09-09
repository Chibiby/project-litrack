import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";

/**
 * Week labels and the attendance editing deadline, in one place so the banner a
 * teacher reads and the server action that enforces it can never drift apart.
 *
 * Month names are hardcoded rather than taken from `Intl`: these labels render on
 * the server and hydrate in the browser, and the two do not always ship the same
 * ICU locale data. A mismatch would be a hydration error.
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Days a week stays editable after it ends. */
export const ATTENDANCE_EDIT_GRACE_DAYS = 7;

/** `August 24, 2026` */
export function formatLongDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Sunday of the Monday-keyed week. */
export function weekEnd(weekStart: Date): Date {
  return addDays(weekStart, 6);
}

/**
 * Last day a week can still be edited: Sunday plus the grace period. The weekly
 * grid locks itself past this date and `saveAralWeeklyAttendance` rejects saves.
 */
export function attendanceDeadline(weekStart: Date): Date {
  return addDays(weekEnd(weekStart), ATTENDANCE_EDIT_GRACE_DAYS);
}

/**
 * `August 11 – August 17, 2026`, en dash. The year appears once unless the week
 * straddles New Year, when both are needed to stay unambiguous.
 */
export function formatWeekRange(weekStartKey: string): string {
  const start = parseLocalDateKey(weekStartKey);
  const end = weekEnd(start);
  const startLabel = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const endLabel = `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${startLabel}, ${start.getFullYear()} – ${endLabel}, ${end.getFullYear()}`;
  }
  return `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
}

/** `Week of September 7 – September 13, 2026` — the week picker's option text. */
export function formatWeekOption(weekStartKey: string): string {
  return `Week of ${formatWeekRange(weekStartKey)}`;
}

/** Past weeks the week picker offers alongside the current one (about six months). */
export const WEEK_PICKER_HISTORY = 26;

/**
 * Mondays for the week picker, newest first: `anchorKey`'s week and the `count`
 * weeks before it.
 *
 * `includeKey` is appended when it falls outside that span. The prev/next
 * buttons can still walk into a week the list does not offer — a future week,
 * or one older than the history — and a `<Select>` whose value is not one of
 * its items renders an empty trigger, so the week on screen always has to be in
 * the list even when nothing else would have put it there.
 */
export function weekPickerKeys(
  anchorKey: string,
  count = WEEK_PICKER_HISTORY,
  includeKey?: string
): string[] {
  const anchor = getMonday(parseLocalDateKey(anchorKey));
  const keys: string[] = [];
  for (let i = 0; i <= count; i += 1) {
    keys.push(formatLocalDateKey(addDays(anchor, -7 * i)));
  }
  if (includeKey) {
    const normalized = formatLocalDateKey(getMonday(parseLocalDateKey(includeKey)));
    if (!keys.includes(normalized)) {
      keys.push(normalized);
      // `YYYY-MM-DD` sorts lexicographically, so plain string order is date order.
      keys.sort().reverse();
    }
  }
  return keys;
}
