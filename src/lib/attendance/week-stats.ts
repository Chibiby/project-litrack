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

export type AttendanceRateInput = {
  /** PRESENT marks on school days (LATE is not present, spec Q5). */
  presentMarks: number;
  /** The grade's current ARAL roster size. */
  learnerCount: number;
  /** Mon–Fri minus that grade's holidays. */
  schoolDays: number;
};

/**
 * The maximum number of marks a roster can hold over `schoolDays`: the
 * denominator of every attendance rate in the app. The division summary sums it
 * across grades and weeks before dividing, so it is exported on its own.
 */
export function attendancePossibleMarks({
  learnerCount,
  schoolDays,
}: Pick<AttendanceRateInput, "learnerCount" | "schoolDays">): number {
  return learnerCount * schoolDays;
}

/**
 * The attendance rate, as every teacher and School Head card shows it: PRESENT
 * marks over possible marks, rounded to a whole percent, 0 when nothing was
 * possible. The one definition of the rate; `computeWeekStats` and the division
 * summary both go through it (the summary via `attendancePossibleMarks`, with
 * its own one-decimal `pct` for display).
 */
export function attendanceRatePct(input: AttendanceRateInput): number {
  const possible = attendancePossibleMarks(input);
  return possible > 0 ? Math.round((input.presentMarks / possible) * 100) : 0;
}

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
  const possible = attendancePossibleMarks({ learnerCount, schoolDays });

  const schoolDaySet = new Set(schoolDayKeys);
  const presentMarks = records.filter(
    (r) => r.status === "PRESENT" && schoolDaySet.has(r.dateKey)
  ).length;
  const ratePct = attendanceRatePct({ presentMarks, learnerCount, schoolDays });

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
