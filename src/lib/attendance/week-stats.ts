import type { AttendanceStatus } from "@prisma/client";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

export type WeekAttendanceRecord = {
  learnerId: string;
  /** Local `YYYY-MM-DD`. */
  dateKey: string;
  status: AttendanceStatus | string;
};

export type WeekStatsInput = {
  learnerCount: number;
  records: WeekAttendanceRecord[];
  /** Local `YYYY-MM-DD` holiday dates for this grade, any that fall in the week. */
  holidayKeys: string[];
  /** Monday of the week, local `YYYY-MM-DD`. */
  weekStartKey: string;
};

export type WeekStats = {
  learnerCount: number;
  /** Mon–Fri of the week, minus any holiday among them. */
  schoolDays: number;
  /** learnerCount * schoolDays — the maximum number of marks the week can hold. */
  possible: number;
  /** Records whose status is PRESENT. */
  presentMarks: number;
  /** Rounded percentage of possible marks that are PRESENT. */
  ratePct: number;
  /** School days where every learner has a record (0 when the roster is empty). */
  daysRecorded: number;
};

/**
 * Pure attendance-week math shared by the stat cards and its Vitest coverage.
 * No React, no server action — just the four numbers the mockup's cards show.
 */
export function computeWeekStats({
  learnerCount,
  records,
  holidayKeys,
  weekStartKey,
}: WeekStatsInput): WeekStats {
  const start = parseLocalDateKey(weekStartKey);
  const holidays = new Set(holidayKeys);

  // Mon–Fri of this week (offsets 0–4 from Monday), minus any that are holidays.
  const schoolDayKeys: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const key = formatLocalDateKey(addDays(start, i));
    if (!holidays.has(key)) schoolDayKeys.push(key);
  }
  const schoolDays = schoolDayKeys.length;
  const possible = learnerCount * schoolDays;

  const schoolDaySet = new Set(schoolDayKeys);
  const presentMarks = records.filter(
    (r) => r.status === "PRESENT" && schoolDaySet.has(r.dateKey)
  ).length;
  const ratePct = possible > 0 ? Math.round((presentMarks / possible) * 100) : 0;

  // A day is "recorded" when every learner in the roster has a mark for it, so
  // a day with zero learners can never count — there is nobody to record.
  let daysRecorded = 0;
  if (learnerCount > 0) {
    const learnersByDay = new Map<string, Set<string>>();
    for (const r of records) {
      if (!schoolDaySet.has(r.dateKey)) continue;
      const set = learnersByDay.get(r.dateKey) ?? new Set<string>();
      set.add(r.learnerId);
      learnersByDay.set(r.dateKey, set);
    }
    for (const key of schoolDayKeys) {
      if ((learnersByDay.get(key)?.size ?? 0) >= learnerCount) daysRecorded += 1;
    }
  }

  return { learnerCount, schoolDays, possible, presentMarks, ratePct, daysRecorded };
}
