import { describe, expect, it } from "vitest";
import { computeWeekStats } from "@/lib/attendance/week-stats";

// Monday of the fixture week.
const WEEK_START = "2026-09-14"; // Mon Sep 14 – Sun Sep 20, 2026

describe("computeWeekStats", () => {
  it("computes a normal, fully-recorded week", () => {
    // 3 learners, 5 school days, everyone marked present every day.
    const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
    const learnerIds = ["l1", "l2", "l3"];
    const records = days.flatMap((day) =>
      learnerIds.map((learnerId) => ({ learnerId, dateKey: day, status: "PRESENT" }))
    );

    const stats = computeWeekStats({
      learnerCount: 3,
      records,
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });

    expect(stats.schoolDays).toBe(5);
    expect(stats.possible).toBe(15);
    expect(stats.presentMarks).toBe(15);
    expect(stats.ratePct).toBe(100);
    expect(stats.daysRecorded).toBe(5);
  });

  it("drops a holiday from school days and shrinks possible", () => {
    // Wednesday Sep 16 is a holiday: school days fall to 4.
    const records = [
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l2", dateKey: "2026-09-14", status: "ABSENT" },
    ];

    const stats = computeWeekStats({
      learnerCount: 2,
      records,
      holidayKeys: ["2026-09-16"],
      weekStartKey: WEEK_START,
    });

    expect(stats.schoolDays).toBe(4);
    expect(stats.possible).toBe(8);
    expect(stats.presentMarks).toBe(1);
    expect(stats.ratePct).toBe(13); // round(1/8*100) = 12.5 -> 13
  });

  it("never divides by zero on an empty roster", () => {
    const stats = computeWeekStats({
      learnerCount: 0,
      records: [],
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });

    expect(stats.possible).toBe(0);
    expect(stats.ratePct).toBe(0);
    expect(stats.daysRecorded).toBe(0);
    expect(Number.isNaN(stats.ratePct)).toBe(false);
  });

  it("counts a day as recorded only when every learner has a mark for it", () => {
    // 3 learners; Monday has all 3 marked, Tuesday only 2 of 3.
    const records = [
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l2", dateKey: "2026-09-14", status: "ABSENT" },
      { learnerId: "l3", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-15", status: "PRESENT" },
      { learnerId: "l2", dateKey: "2026-09-15", status: "PRESENT" },
    ];

    const stats = computeWeekStats({
      learnerCount: 3,
      records,
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });

    expect(stats.daysRecorded).toBe(1);
  });

  it("rounds the attendance rate to the nearest whole percent", () => {
    // 1 learner, 5 school days, 2 present marks -> 2/5 = 40%, exact.
    const records = [
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-15", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-16", status: "ABSENT" },
    ];

    const stats = computeWeekStats({
      learnerCount: 1,
      records,
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });

    expect(stats.ratePct).toBe(40);
  });

  it("ignores records outside the week's school days (weekends, out-of-range)", () => {
    const records = [
      // Sunday Sep 20 is not a school day at all.
      { learnerId: "l1", dateKey: "2026-09-20", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
    ];

    const stats = computeWeekStats({
      learnerCount: 1,
      records,
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });

    expect(stats.presentMarks).toBe(1);
  });
});
