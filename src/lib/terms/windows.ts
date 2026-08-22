import { formatLocalDateKey } from "@/lib/date-keys";
import { addMonths, monthEndDay } from "@/lib/month-range";

/**
 * Term windows for the End of Terms grade sheet.
 *
 * A term is three whole months, snapped to month boundaries, counted from the
 * month the active `SchoolYear` starts in. Nothing about a window is stored: a
 * school starting in August gets Aug–Oct / Nov–Jan / Feb–Apr and one starting in
 * June gets Jun–Aug / Sep–Nov / Dec–Feb, with no seed rows, no backfill and no
 * cron to keep in sync.
 *
 * Everything here is pure and string-comparison based, so the label a teacher
 * reads and the lock the save action enforces are derived from the same two
 * functions and cannot drift.
 */

/** Ordered terms. Index is the window offset: term N starts at month N*3. */
export const TERM_PERIODS = ["FIRST", "SECOND", "THIRD"] as const;

export type TermPeriodValue = (typeof TERM_PERIODS)[number];

export type TermWindow = {
  term: TermPeriodValue;
  /** "First Term" */
  label: string;
  /** "August - October" — month names only, matching the approved sheet. */
  rangeLabel: string;
  /** Local `YYYY-MM-DD` of the first day of the window's first month. */
  startKey: string;
  /** Local `YYYY-MM-DD` of the last day of the window's last month. */
  endKey: string;
};

const TERM_LABELS: Record<TermPeriodValue, string> = {
  FIRST: "First Term",
  SECOND: "Second Term",
  THIRD: "Third Term",
};

/**
 * Hardcoded rather than taken from `Intl`, for the same reason
 * `src/lib/month-range.ts` hardcodes its own: these labels render on the server
 * and hydrate in the browser, and the two do not always ship the same ICU locale
 * data. A mismatch would be a hydration error.
 */
const MONTH_NAMES = [
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

/**
 * The three windows for a school year, derived from its start date.
 *
 * The anchor month is read off the LOCAL date key — never `getUTCMonth()` or
 * `toISOString()`. `SchoolYear.startDate` is a bare `DateTime` (a timestamp, not
 * `@db.Date`), so a school year that starts on August 1 in Manila is stored as
 * `2026-07-31T16:00:00Z`; reading the UTC month would put Term 1 in July and
 * shift all three windows a month early.
 */
export function getTermWindows(schoolYearStart: Date): TermWindow[] {
  const [year, month] = formatLocalDateKey(schoolYearStart)
    .slice(0, 7)
    .split("-")
    .map(Number);
  const anchor = new Date(year, month - 1, 1);

  return TERM_PERIODS.map((term, index) => {
    const start = addMonths(anchor, index * 3);
    const end = monthEndDay(addMonths(anchor, index * 3 + 2));
    return {
      term,
      label: TERM_LABELS[term],
      rangeLabel: `${MONTH_NAMES[start.getMonth()]} - ${MONTH_NAMES[end.getMonth()]}`,
      startKey: formatLocalDateKey(start),
      endKey: formatLocalDateKey(end),
    };
  });
}

/**
 * A term is locked once its last day has passed — inclusive on the last day
 * itself, so a teacher encoding on October 31 is still open.
 *
 * `todayKey` must come from `formatLocalDateKey(schoolToday())`, never from a
 * bare `new Date()`: the server runs in UTC and the school in UTC+8, so between
 * midnight and 08:00 Manila a raw date resolves to yesterday and every term
 * would lock a day early.
 *
 * String comparison on `YYYY-MM-DD` is a total order, which sidesteps `Date`
 * arithmetic entirely.
 */
export function isTermLocked(window: TermWindow, todayKey: string): boolean {
  return todayKey > window.endKey;
}

/** The window for a term string, or `null` when it names no term. */
export function resolveTermWindow(
  windows: TermWindow[],
  term: string
): TermWindow | null {
  return windows.find((w) => w.term === term) ?? null;
}
