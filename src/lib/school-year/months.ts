/**
 * School years are set by month: a School Head picks the start month and, when
 * known, the end month. Stored as UTC-midnight dates — the first day of the start
 * month, the last day of the end month — so every date-range reader keeps working.
 *
 * Pure: no Prisma, no `server-only`, so forms, actions and tests share it.
 */

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

/** How long a year runs when its end month is not set yet: June → April. */
const DEFAULT_SPAN_MONTHS = 10;

/** `YYYY-MM` → [year, monthIndex 0-11], or null when it is not a real month. */
export function parseMonthKey(value: string): [number, number] | null {
  const m = MONTH_KEY.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return [year, month - 1];
}

/** First day of the month, UTC midnight. */
export function monthStart(value: string): Date | null {
  const p = parseMonthKey(value);
  return p ? new Date(Date.UTC(p[0], p[1], 1)) : null;
}

/** Last day of the month, UTC midnight. */
export function monthEnd(value: string): Date | null {
  const p = parseMonthKey(value);
  return p ? new Date(Date.UTC(p[0], p[1] + 1, 0)) : null;
}

/** `Date` → `YYYY-MM` (UTC, matching how the dates are stored). */
export function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The end every report and term window uses. A year whose end month is not
 * set yet runs to the end of the tenth month after it starts, so a year begun
 * in June ends April 30 — the usual DepEd calendar.
 */
export function effectiveYearEnd(startDate: Date, endDate: Date | null): Date {
  if (endDate) return endDate;
  return new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + DEFAULT_SPAN_MONTHS + 1, 0)
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 2026" */
export function formatMonth(date: Date): string {
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "Jun 2026 – Apr 2027", or "Jun 2026 – end not set". */
export function formatYearMonths(startDate: Date, endDate: Date | null): string {
  return `${formatMonth(startDate)} – ${endDate ? formatMonth(endDate) : "end not set"}`;
}
