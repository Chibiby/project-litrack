import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMonths,
  currentMonthKey,
  daysLeftInMonth,
  formatMonthEndLongDate,
  formatMonthKey,
  formatMonthLabel,
  monthEndDay,
  monthStartOf,
  nextMonthStart,
} from "@/lib/month-range";

/**
 * The ARAL reading level is assessed per calendar month, and the whole feature
 * keys a month by its 1st. These assert the two properties everything downstream
 * assumes: any date in a month resolves to the same anchor, and the labels a
 * teacher reads come from the same arithmetic as the range the query uses.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("month anchors", () => {
  it("collapses every date in a month onto its 1st", () => {
    for (const day of [1, 2, 13, 30, 31]) {
      expect(formatMonthKey(new Date(2026, 7, day))).toBe("2026-08-01");
    }
  });

  it("keeps the anchor at local midnight, so no UTC shift can move the day", () => {
    const start = monthStartOf(new Date(2026, 7, 13, 23, 59, 59));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });

  it("bounds a month as [1st, next 1st) — the range the queries use", () => {
    const august = new Date(2026, 7, 13);
    expect(formatMonthKey(monthStartOf(august))).toBe("2026-08-01");
    expect(formatMonthKey(nextMonthStart(august))).toBe("2026-09-01");
    // Exclusive upper bound: the last instant of August 31 is still inside.
    expect(new Date(2026, 7, 31, 23, 59, 59) < nextMonthStart(august)).toBe(true);
  });

  it("rolls the year at the December/January boundary", () => {
    expect(formatMonthKey(nextMonthStart(new Date(2026, 11, 15)))).toBe("2027-01-01");
    expect(formatMonthKey(addMonths(new Date(2027, 0, 15), -1))).toBe("2026-12-01");
  });

  it("steps whole months and always lands on the 1st", () => {
    expect(formatMonthKey(addMonths(new Date(2026, 7, 31), 1))).toBe("2026-09-01");
    // From a 31-day month into a 30-day one: no day-overflow into October.
    expect(addMonths(new Date(2026, 7, 31), 1).getMonth()).toBe(8);
    expect(formatMonthKey(addMonths(new Date(2026, 7, 13), -2))).toBe("2026-06-01");
  });

  it("finds the last day of short, long, and leap-February months", () => {
    expect(monthEndDay(new Date(2026, 7, 1)).getDate()).toBe(31);
    expect(monthEndDay(new Date(2026, 8, 1)).getDate()).toBe(30);
    expect(monthEndDay(new Date(2026, 1, 1)).getDate()).toBe(28);
    expect(monthEndDay(new Date(2028, 1, 1)).getDate()).toBe(29);
  });
});

describe("month labels", () => {
  it("spells the month and year for the page header", () => {
    expect(formatMonthLabel("2026-08-01")).toBe("August 2026");
    expect(formatMonthLabel("2027-01-01")).toBe("January 2027");
  });

  it("labels any date in the month the same way, not just the anchor", () => {
    expect(formatMonthLabel("2026-08-13")).toBe("August 2026");
  });

  it("spells the due date out in full", () => {
    expect(formatMonthEndLongDate("2026-08-01")).toBe("August 31, 2026");
    expect(formatMonthEndLongDate("2026-09-01")).toBe("September 30, 2026");
    expect(formatMonthEndLongDate("2028-02-01")).toBe("February 29, 2028");
  });
});

describe("the school's current month", () => {
  it("reads the Manila civil month, not the server's UTC one", () => {
    // 23:30 UTC on July 31 is already 07:30 on August 1 in Manila. A UTC lambda
    // would report July here, and every teacher would open the wrong month.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:30:00Z"));
    expect(currentMonthKey()).toBe("2026-08-01");
  });

  it("counts days remaining to the last day of the month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T05:00:00Z")); // 13:00 Aug 13 in Manila
    expect(daysLeftInMonth("2026-08-01")).toBe(18);
  });

  it("returns 0 on the last day and goes negative once the month has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T05:00:00Z"));
    expect(daysLeftInMonth("2026-08-01")).toBe(0);
    expect(daysLeftInMonth("2026-07-01")).toBe(-31);
    expect(daysLeftInMonth("2026-09-01")).toBe(30);
  });
});
