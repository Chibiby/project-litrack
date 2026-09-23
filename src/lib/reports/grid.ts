/**
 * Pure date/period math for the Reports Hub's grid-shaped builders
 * (`buildAttendanceTable`, `buildReadingLevelTable` in `./queries.ts`).
 *
 * Kept dependency-free of Prisma so it is unit-testable without a database
 * fake — `queries.ts` is the only caller and does the fetching; this module
 * only decides WHICH dates/periods make up the grid and how many rows fit.
 */

import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

export type DateRange = {
  /** Inclusive local `YYYY-MM-DD`. */
  startKey: string;
  /** Inclusive local `YYYY-MM-DD`. */
  endKey: string;
  /** Subtitle line naming how the range was resolved. */
  label: string;
};

/** The one field of `SchoolYear` this module needs, kept narrow for tests. */
export type SchoolYearWindow = { startDate: Date; endDate: Date } | null;

/**
 * Resolves the report's date range from the hub's filters, per the rule
 * table in the Reports Hub spec:
 *
 *   - both `from`/`to` set        → that range, verbatim.
 *   - only `from` set             → `from` .. today.
 *   - only `to` set                → (active year start, else `to` - 30 days) .. `to`.
 *   - neither set                 → active year start .. min(today, year end);
 *                                    with no active year, Monday of the
 *                                    current week .. today.
 *
 * `today` is a parameter (default `schoolToday()` at the call site is the
 * caller's job) so this stays pure and testable without mocking the clock.
 */
export function resolveDateRange(
  filters: { from?: string | null; to?: string | null },
  schoolYear: SchoolYearWindow,
  today: Date
): DateRange {
  const todayKey = formatLocalDateKey(today);

  if (filters.from && filters.to) {
    return {
      startKey: filters.from,
      endKey: filters.to,
      label: `Range: ${filters.from} to ${filters.to}`,
    };
  }

  if (filters.from && !filters.to) {
    return {
      startKey: filters.from,
      endKey: todayKey,
      label: `Range: ${filters.from} to today (${todayKey})`,
    };
  }

  if (!filters.from && filters.to) {
    const startKey = schoolYear
      ? formatLocalDateKey(schoolYear.startDate)
      : formatLocalDateKey(addDays(parseLocalDateKey(filters.to), -30));
    return { startKey, endKey: filters.to, label: `Range: ${startKey} to ${filters.to}` };
  }

  if (schoolYear) {
    const startKey = formatLocalDateKey(schoolYear.startDate);
    const yearEndKey = formatLocalDateKey(schoolYear.endDate);
    const endKey = yearEndKey < todayKey ? yearEndKey : todayKey;
    return {
      startKey,
      endKey,
      label: `Range: active school year (${startKey} to ${endKey})`,
    };
  }

  // No active year: Monday of the current week through today. `getDay()` is
  // 0 (Sun) .. 6 (Sat); Sunday is 6 days after the preceding Monday, every
  // other day is `getDay() - 1` days after it.
  const dow = today.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const mondayKey = formatLocalDateKey(addDays(today, -daysSinceMonday));
  return {
    startKey: mondayKey,
    endKey: todayKey,
    label: `Range: this week (${mondayKey} to ${todayKey})`,
  };
}

/** Every Mon-Fri local date key in an inclusive `[startKey, endKey]` range. */
export function enumerateWeekdays(startKey: string, endKey: string): string[] {
  const start = parseLocalDateKey(startKey);
  const end = parseLocalDateKey(endKey);
  const keys: string[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) keys.push(formatLocalDateKey(cur));
  }
  return keys;
}

/** The 1st-of-month local date key for every month touched by `[startKey, endKey]`. */
export function enumerateMonthStarts(startKey: string, endKey: string): string[] {
  const start = parseLocalDateKey(startKey);
  const end = parseLocalDateKey(endKey);
  const keys: string[] = [];
  for (
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    cur <= new Date(end.getFullYear(), end.getMonth(), 1);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  ) {
    keys.push(formatLocalDateKey(cur));
  }
  return keys;
}

/** Sorted, de-duplicated union of two local date-key lists. */
export function unionDateKeys(base: string[], extra: string[]): string[] {
  return [...new Set([...base, ...extra])].sort();
}

/** Grid cells (dates/periods × learners) above which a report gets capped. */
export const GRID_CELL_CAP = 10_000;

export type GridCap = {
  /** The dates/periods that fit under the cap. */
  keys: string[];
  capped: boolean;
};

/**
 * Keeps the LATEST dates/periods that fit `learnerCount * keys.length <=
 * GRID_CELL_CAP`, dropping the earliest ones first — `keys` must already be
 * sorted ascending, which every caller in this module produces.
 *
 * A school with more learners than the cap allows even a single date/period
 * for returns an empty grid rather than a divide-by-zero; `learnerCount <= 0`
 * is never capped, since an empty roster has no cells to overflow.
 */
export function capGridKeys(keys: string[], learnerCount: number): GridCap {
  if (learnerCount <= 0) return { keys, capped: false };
  const maxKeys = Math.floor(GRID_CELL_CAP / learnerCount);
  if (keys.length <= maxKeys) return { keys, capped: false };
  return { keys: keys.slice(keys.length - Math.max(maxKeys, 0)), capped: true };
}

/** The cap subtitle line, e.g. "Showing the latest 40 school day(s); narrow the date range to see earlier days." */
export function capNote(count: number, unit: "school day" | "period"): string {
  const plural = unit === "school day" ? "days" : "periods";
  return `Showing the latest ${count} ${unit}(s); narrow the date range to see earlier ${plural}.`;
}
