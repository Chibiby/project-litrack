import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

export type MonthCell = { day: number; key: string; isToday: boolean } | null;

/** Sunday-first weeks for the month containing `todayKey`, padded with nulls. */
export function buildMonthGrid(todayKey: string): {
  monthLabel: string;
  weeks: MonthCell[][];
} {
  const today = parseLocalDateKey(todayKey);
  const year = today.getFullYear();
  const month = today.getMonth();
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
