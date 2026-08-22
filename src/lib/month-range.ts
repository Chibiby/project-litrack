import { formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";

/**
 * Month labels and bounds for the ARAL reading-level cadence, in one place so
 * the header a teacher reads and the server action that keys the record can
 * never drift apart. Mirrors `week-range.ts` for the attendance side.
 *
 * Month names are hardcoded rather than taken from `Intl`: these labels render
 * on the server and hydrate in the browser, and the two do not always ship the
 * same ICU locale data. A mismatch would be a hydration error.
 *
 * A note on what these helpers do NOT mean: nothing in the schema stores a
 * "submitted" or "locked" state for reading levels, and
 * `src/lib/dashboard/teacher-overview.ts` deliberately refuses to imply one.
 * These helpers describe the program's monthly *cadence* — a due date a teacher
 * is working toward. Callers must not render a past month as read-only, because
 * no server rule enforces that and claiming otherwise would tell a teacher a
 * rule the system does not actually have.
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

/**
 * Whole days from the school's today to the month's last day: 0 on the last day
 * itself, negative once the month has passed.
 */
export function daysLeftInMonth(monthKey: string): number {
  const end = monthEndDay(parseLocalDateKey(monthKey));
  const today = schoolToday();
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}
