import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";

const COUNT = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** One decimal, as the facets round; an em dash when there is no base. */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

export function formatMean(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

/**
 * Clock time the figures were computed, in school time. The server renders in
 * UTC on Workers, so the zone is explicit.
 */
export function formatComputedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(date);
}
