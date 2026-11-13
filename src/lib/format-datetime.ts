import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";

const dateTimeFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: SCHOOL_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: SCHOOL_TIME_ZONE,
  dateStyle: "medium",
});

/** Fixed locale and zone so SSR (UTC on Workers) and the PH browser agree. */
export function formatSchoolDateTime(value: Date | string | number): string {
  return dateTimeFormat.format(new Date(value));
}

const stampFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD HH:MM:SS" in Manila time, for log tables. */
export function formatSchoolTimestamp(value: Date | string | number): string {
  const p = Object.fromEntries(
    stampFormat.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** "YYYY-MM-DD" of the Manila calendar day the instant falls on. */
export function formatSchoolDateKey(value: Date | string | number): string {
  const p = Object.fromEntries(
    stampFormat.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatSchoolDate(value: Date | string | number): string {
  return dateFormat.format(new Date(value));
}
