/**
 * Pure chart/aggregate helpers (no Prisma) — unit-testable empty-input behavior.
 */

export type NamedCount = { name: string; value: number };
export type DayCount = { date: string; value: number };

/** Build a 7-day series of zero counts when there is no activity. */
export function emptyActivitySeries(dayLabels: string[]): DayCount[] {
  return dayLabels.map((date) => ({ date, value: 0 }));
}

/** True when every series point is zero or the series is empty. */
export function isChartSeriesEmpty(series: { value: number }[]): boolean {
  if (series.length === 0) return true;
  return series.every((p) => p.value === 0);
}

/** Map profile key → count into labeled NamedCount list (missing keys → 0). */
export function distributionFromCounts(
  keys: string[],
  counts: Map<string, number>,
  labelFn: (key: string) => string
): NamedCount[] {
  return keys.map((k) => ({
    name: labelFn(k),
    value: counts.get(k) ?? 0,
  }));
}

/** Sum values; returns 0 for empty input. */
export function sumNamedCounts(series: NamedCount[]): number {
  return series.reduce((n, p) => n + p.value, 0);
}
