import { addDays, formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";

/**
 * Month labels and bounds for the ARAL reading-level cadence, in one place so
 * the header a teacher reads and the server action that keys the record can
 * never drift apart. Mirrors `week-range.ts` for the attendance side.
 *
 * Month names are hardcoded rather than taken from `Intl`: these labels render
 * on the server and hydrate in the browser, and the two do not always ship the
 * same ICU locale data. A mismatch would be a hydration error.
 *
 * The reading-level deadline is enforced server-side in
 * `bulkRecordMonthlyReadingLevel` (`src/lib/actions/reading-level.ts`), gated by
 * a program-wide switch that currently defaults to unlocked. Callers here just
 * compute the same date and its label so the banner a teacher reads and the
 * rule the action enforces can never drift apart.
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


/** 1st of the month `date` falls in, at local midnight. */
export function monthStartOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 1st of the following month — the exclusive upper bound for range queries. */
export function nextMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/** Last calendar day of the month `date` falls in. */
export function monthEndDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Step whole months, always landing on the 1st. */
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/**
 * `YYYY-MM-01` — a normal local date key, so `parseLocalDateKey` and
 * `<input type="month">`/`<input type="date">` all accept it without a special
 * case, and the value round-trips through the URL unchanged.
 */
export function formatMonthKey(date: Date): string {
  return formatLocalDateKey(monthStartOf(date));
}

/** The current school month as `YYYY-MM-01`. */
export function currentMonthKey(): string {
  return formatMonthKey(schoolToday());
}

/** `August 2026` */
export function formatMonthLabel(monthKey: string): string {
  const d = parseLocalDateKey(monthKey);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `August 31, 2026` — the last day of the month, spelled out. */
export function formatMonthEndLongDate(monthKey: string): string {
  const d = monthEndDay(parseLocalDateKey(monthKey));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Days a month stays editable after it ends, mirroring `ATTENDANCE_EDIT_GRACE_DAYS`. */
export const READING_LEVEL_EDIT_GRACE_DAYS = 7;

/**
 * Last day a month's reading levels can still be saved: the month's last day
 * plus the grace period, at local midnight. `bulkRecordMonthlyReadingLevel`
 * rejects saves past this date once the program-wide lock switch is on.
 */
export function readingLevelDeadline(monthKey: string): Date {
  return addDays(monthEndDay(parseLocalDateKey(monthKey)), READING_LEVEL_EDIT_GRACE_DAYS);
}

/** `September 7, 2026` — the reading-level deadline, spelled out like `formatLongDate`. */
export function formatMonthDeadlineLongDate(monthKey: string): string {
  const d = readingLevelDeadline(monthKey);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Whole days from the school's today to the month's last day: 0 on the last day
 * itself, negative once the month has passed.
 */
export function daysLeftInMonth(monthKey: string): number {
  const end = monthEndDay(parseLocalDateKey(monthKey));
  const today = schoolToday();
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

/** Past months the month picker offers alongside the current one (two school years). */
export const MONTH_PICKER_HISTORY = 24;

/**
 * Month keys for the month picker, newest first: `anchorKey`'s month and the
 * `count` months before it.
 *
 * `includeKey` is appended when it falls outside that span — the prev/next
 * buttons can walk into a future month, or one older than the history, and a
 * `<Select>` whose value matches no item renders an empty trigger.
 */
export function monthPickerKeys(
  anchorKey: string,
  count = MONTH_PICKER_HISTORY,
  includeKey?: string
): string[] {
  const anchor = monthStartOf(parseLocalDateKey(anchorKey));
  const keys: string[] = [];
  for (let i = 0; i <= count; i += 1) {
    keys.push(formatMonthKey(addMonths(anchor, -i)));
  }
  if (includeKey) {
    const normalized = formatMonthKey(parseLocalDateKey(includeKey));
    if (!keys.includes(normalized)) {
      keys.push(normalized);
      // `YYYY-MM-DD` sorts lexicographically, so plain string order is date order.
      keys.sort().reverse();
    }
  }
  return keys;
}
