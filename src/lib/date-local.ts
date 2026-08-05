/**
 * Attendance / calendar dates are stored as Postgres `@db.Date` (date-only).
 * Policy: treat `YYYY-MM-DD` form values as LOCAL calendar dates in the server's
 * local timezone. Do not use `new Date("YYYY-MM-DD")` (UTC midnight) or
 * `toISOString().slice(0, 10)` for defaults — those shift the calendar day in
 * timezones ahead of UTC (e.g. Asia/Manila UTC+8).
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` as local midnight. */
export function parseLocalDateYmd(ymd: string): Date {
  const m = YMD.exec(ymd.trim());
  if (!m) {
    throw new Error(`Invalid local date: ${ymd}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return new Date(year, month - 1, day);
}

/** Format a Date as local `YYYY-MM-DD` (no UTC conversion). */
export function formatLocalDateYmd(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
