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

export function formatSchoolDate(value: Date | string | number): string {
  return dateFormat.format(new Date(value));
}
