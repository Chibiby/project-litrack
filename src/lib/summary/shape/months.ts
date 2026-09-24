import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

/**
 * Month arithmetic for summary params. A month is a `YYYY-MM` key; every date
 * handed to SQL is a local `YYYY-MM-DD` key cast with `::date`, so no timezone
 * can move a boundary (CLAUDE.md, Dates).
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

function parts(monthKey: string): [number, number] {
  const [y, m] = monthKey.split("-").map(Number);
  return [y!, m!];
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = parts(monthKey);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** First day of the month, `YYYY-MM-01`. */
export function monthStartKey(monthKey: string): string {
  return `${monthKey}-01`;
}

/** Every month from `from` to `to`, inclusive, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = parts(monthKey);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * July of the school year `todayKey` falls in: the DOCX's reading-behaviour
 * snapshot ("as of July"). Before July, that is last calendar year's July.
 */
export function defaultJulyMonth(todayKey: string): string {
  const [y, m] = parts(monthKeyOf(todayKey));
  return `${m >= 7 ? y : y - 1}-07`;
}

/** The last `count` months ending with `todayKey`'s month. */
export function defaultMonthRange(todayKey: string, count = 3): { from: string; to: string } {
  const to = monthKeyOf(todayKey);
  return { from: shiftMonth(to, -(count - 1)), to };
}

/**
 * Monday keys of every week whose Monday falls in `from`..`to` (inclusive
 * months) and is on or before `untilKey` — weeks that have not started are not
 * counted against anyone.
 */
export function mondaysInMonths(from: string, to: string, untilKey: string): string[] {
  const start = parseLocalDateKey(monthStartKey(from));
  const offset = (start.getDay() + 6) % 7; // days since Monday
  let monday = offset === 0 ? start : addDays(start, 7 - offset);
  const out: string[] = [];
  for (;;) {
    const key = formatLocalDateKey(monday);
    if (monthKeyOf(key) > to || key > untilKey) break;
    out.push(key);
    monday = addDays(monday, 7);
  }
  return out;
}

/** Monday and Friday keys of the last full Mon–Fri week that ended before `todayKey`. */
export function lastFullWeek(todayKey: string): { monday: string; friday: string } {
  const today = parseLocalDateKey(todayKey);
  const offset = (today.getDay() + 6) % 7; // 0 = Monday
  // A Saturday or Sunday already has this week's Friday behind it.
  const thisMonday = addDays(today, -offset);
  const monday = offset >= 5 ? thisMonday : addDays(thisMonday, -7);
  return { monday: formatLocalDateKey(monday), friday: formatLocalDateKey(addDays(monday, 4)) };
}
