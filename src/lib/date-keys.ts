/** Local calendar YYYY-MM-DD (avoids UTC shift from toISOString). */
export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse `YYYY-MM-DD` as local midnight; falls back to today (local). */
export function parseLocalDateKey(value?: string | null): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Every LITRACK school operates in Philippine Standard Time. Deployment
 * environments do not: Vercel lambdas run with `TZ=UTC`, and no `TZ` is set in
 * this repo's config, so a bare `new Date()` on the server resolves to the
 * previous civil day for every request between 00:00 and 08:00 in Manila.
 */
export const SCHOOL_TIME_ZONE = "Asia/Manila";

/**
 * Today's civil date in the school's timezone, returned as a Date at *runtime*
 * local midnight so it composes with `formatLocalDateKey`, `addDays`, and the
 * week/month bounds helpers, all of which read local calendar fields.
 *
 * Use this rather than `new Date()` anywhere a "today", "this week", or "this
 * month" boundary is being computed for a school.
 */
export function schoolToday(now: Date = new Date()): Date {
  // en-CA formats as YYYY-MM-DD, which parseLocalDateKey already accepts.
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseLocalDateKey(key);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}
