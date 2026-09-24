import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  attendancePossibleMarks,
  attendanceRatePct,
  computeWeekStats,
} from "@/lib/attendance/week-stats";
import { attendanceFacetRows, type RawAttendanceRow } from "@/lib/summary/queries/attendance";
import { mondaysInMonths } from "@/lib/summary/shape/months";

/**
 * T16: the attendance rate has one definition. `computeWeekStats` (the teacher
 * and School Head cards) now calls `attendanceRatePct`, and the summary uses the
 * same possible-marks denominator. The cases are the fixtures of
 * `tests/unit/attendance-week-stats.test.ts`, with the rate each produced
 * before the refactor.
 */

const WEEK_START = "2026-09-14";
const DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];

const FIXTURES = [
  {
    name: "a fully recorded week",
    learnerCount: 3,
    holidayKeys: [] as string[],
    records: DAYS.flatMap((d) => ["l1", "l2", "l3"].map((l) => ({ learnerId: l, dateKey: d, status: "PRESENT" }))),
    ratePct: 100,
  },
  {
    name: "a holiday week",
    learnerCount: 2,
    holidayKeys: ["2026-09-16"],
    records: [
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l2", dateKey: "2026-09-14", status: "ABSENT" },
    ],
    ratePct: 13,
  },
  { name: "an empty roster", learnerCount: 0, holidayKeys: [], records: [], ratePct: 0 },
  {
    name: "two of five present",
    learnerCount: 1,
    holidayKeys: [],
    records: [
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-15", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-16", status: "ABSENT" },
    ],
    ratePct: 40,
  },
  {
    name: "a weekend mark",
    learnerCount: 1,
    holidayKeys: [],
    records: [
      { learnerId: "l1", dateKey: "2026-09-20", status: "PRESENT" },
      { learnerId: "l1", dateKey: "2026-09-14", status: "PRESENT" },
    ],
    ratePct: 20,
  },
];

describe("attendanceRatePct", () => {
  it.each(FIXTURES)("computeWeekStats keeps its pre-refactor rate for $name", (f) => {
    const stats = computeWeekStats({
      learnerCount: f.learnerCount,
      records: f.records,
      holidayKeys: f.holidayKeys,
      weekStartKey: WEEK_START,
    });
    expect(stats.ratePct).toBe(f.ratePct);
    expect(
      attendanceRatePct({
        presentMarks: stats.presentMarks,
        learnerCount: stats.learnerCount,
        schoolDays: stats.schoolDays,
      })
    ).toBe(stats.ratePct);
    expect(attendancePossibleMarks(stats)).toBe(stats.possible);
  });

  it("counts LATE as not present (Q5)", () => {
    const stats = computeWeekStats({
      learnerCount: 1,
      records: [{ learnerId: "l1", dateKey: "2026-09-14", status: "LATE" }],
      holidayKeys: [],
      weekStartKey: WEEK_START,
    });
    expect(stats.presentMarks).toBe(0);
  });
});

describe("summary attendance rows", () => {
  it("uses the same denominator: roster × (5 − the grade's holidays) per week", () => {
    const raw: RawAttendanceRow[] = [
      { kind: "roster", school_id: "s1", grade_level_id: "g3", gt: "G3", week: null, n: 2 },
      { kind: "present", school_id: "s1", grade_level_id: "g3", gt: null, week: "2026-09-14", n: 1 },
      { kind: "holiday", school_id: null, grade_level_id: "g3", gt: null, week: "2026-09-14", n: 1 },
    ];
    const { weekly, monthly } = attendanceFacetRows(raw, ["2026-09-14", "2026-09-21"]);
    expect(weekly).toEqual([
      { schoolId: "s1", gradeType: "G3", field: "week", bucket: "2026-09-14", count: 1, base: 8 },
      { schoolId: "s1", gradeType: "G3", field: "week", bucket: "2026-09-21", count: 0, base: 10 },
    ]);
    // The holiday-week fixture above: 1 present of 8 possible, the card's 13%.
    expect(attendanceRatePct({ presentMarks: 1, learnerCount: 2, schoolDays: 4 })).toBe(13);
    expect(monthly.every((r) => r.bucket === "2026-09")).toBe(true);
  });

  it("counts only Mondays in range and not after today", () => {
    expect(mondaysInMonths("2026-09", "2026-09", "2026-09-24")).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
    expect(mondaysInMonths("2026-08", "2026-08", "2026-12-31")).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });
});
