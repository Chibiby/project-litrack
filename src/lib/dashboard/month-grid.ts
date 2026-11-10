import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

export type MonthCell = { day: number; key: string; isToday: boolean } | null;

/**
 * Sunday-first weeks for one month, padded with nulls. The month shown is the
 * one containing `monthKey` (default: `todayKey`), so a calendar can page to
 * other months while still marking today.
 */
export function buildMonthGrid(
  todayKey: string,
  monthKey: string = todayKey
): {
  monthLabel: string;
  weeks: MonthCell[][];
} {
  const shown = parseLocalDateKey(monthKey);
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: MonthCell[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = formatLocalDateKey(new Date(year, month, day));
    cells.push({ day, key, isToday: key === todayKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(first);
  return { monthLabel, weeks };
}
