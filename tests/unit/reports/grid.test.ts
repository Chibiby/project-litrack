import { describe, expect, it } from "vitest";
import {
  capGridKeys,
  capNote,
  enumerateMonthStarts,
  enumerateWeekdays,
  resolveDateRange,
  unionDateKeys,
} from "@/lib/reports/grid";

/**
 * Pure date/period math backing the grid-shaped builders
 * (`buildAttendanceTable`, `buildReadingLevelTable`). No Prisma here — see
 * `src/lib/reports/grid.ts`'s own module doc for why.
 */

describe("resolveDateRange", () => {
  const today = new Date(2026, 8, 23); // 2026-09-23, a Wednesday

  it("uses both filters verbatim when both are supplied", () => {
    const range = resolveDateRange({ from: "2026-08-01", to: "2026-08-10" }, null, today);
    expect(range).toMatchObject({ startKey: "2026-08-01", endKey: "2026-08-10" });
  });

  it("runs from -> today when only `from` is supplied", () => {
    const range = resolveDateRange({ from: "2026-08-01" }, null, today);
    expect(range.startKey).toBe("2026-08-01");
    expect(range.endKey).toBe("2026-09-23");
  });

  it("runs (active year start) -> to when only `to` is supplied and a year is active", () => {
    const schoolYear = { startDate: new Date(2026, 5, 1), endDate: new Date(2027, 2, 31) };
    const range = resolveDateRange({ to: "2026-08-10" }, schoolYear, today);
    expect(range.startKey).toBe("2026-06-01");
    expect(range.endKey).toBe("2026-08-10");
  });

  it("runs (to - 30 days) -> to when only `to` is supplied and no year is active", () => {
    const range = resolveDateRange({ to: "2026-08-10" }, null, today);
    expect(range.startKey).toBe("2026-07-11");
    expect(range.endKey).toBe("2026-08-10");
  });

  it("defaults to the active school year, clamped to today, when neither filter is set", () => {
    const schoolYear = { startDate: new Date(2026, 5, 1), endDate: new Date(2027, 2, 31) };
    const range = resolveDateRange({}, schoolYear, today);
    expect(range.startKey).toBe("2026-06-01");
    // The year's end (2027-03-31) is after today, so today wins (min rule).
    expect(range.endKey).toBe("2026-09-23");
  });

  it("clamps to the school year's own end when that end is before today", () => {
    const schoolYear = { startDate: new Date(2025, 5, 1), endDate: new Date(2026, 2, 31) };
    const range = resolveDateRange({}, schoolYear, today);
    expect(range.endKey).toBe("2026-03-31");
  });

  it("defaults to Monday-of-this-week -> today when neither filter is set and no year is active", () => {
    const range = resolveDateRange({}, null, today);
    // 2026-09-23 is a Wednesday; its Monday is 2026-09-21.
    expect(range.startKey).toBe("2026-09-21");
    expect(range.endKey).toBe("2026-09-23");
  });

  it("resolves Sunday's own Monday as six days earlier", () => {
    const sunday = new Date(2026, 8, 27); // 2026-09-27
    const range = resolveDateRange({}, null, sunday);
    expect(range.startKey).toBe("2026-09-21");
    expect(range.endKey).toBe("2026-09-27");
  });
});

describe("enumerateWeekdays", () => {
  it("lists Mon-Fri only, dropping Sat/Sun, across a week", () => {
    // 2026-08-24 (Mon) .. 2026-08-30 (Sun).
    const dates = enumerateWeekdays("2026-08-24", "2026-08-30");
    expect(dates).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
  });

  it("enumerates correctly across a month boundary", () => {
    // 2026-08-31 (Mon) .. 2026-09-02 (Wed).
    const dates = enumerateWeekdays("2026-08-31", "2026-09-02");
    expect(dates).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
  });

  it("returns nothing for a range that falls entirely on a weekend", () => {
    const dates = enumerateWeekdays("2026-08-29", "2026-08-30");
    expect(dates).toEqual([]);
  });
});

describe("enumerateMonthStarts", () => {
  it("lists the 1st of every month touched by the range, including partial months", () => {
    const periods = enumerateMonthStarts("2026-07-15", "2026-09-02");
    expect(periods).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("returns a single period for a range inside one month", () => {
    expect(enumerateMonthStarts("2026-08-05", "2026-08-20")).toEqual(["2026-08-01"]);
  });
});

describe("unionDateKeys", () => {
  it("merges and sorts, dropping duplicates", () => {
    const merged = unionDateKeys(
      ["2026-08-24", "2026-08-25"],
      ["2026-08-25", "2026-08-30"]
    );
    expect(merged).toEqual(["2026-08-24", "2026-08-25", "2026-08-30"]);
  });

  it("keeps a weekend record date that a weekday-only base list would drop", () => {
    const weekdays = enumerateWeekdays("2026-08-24", "2026-08-28");
    const merged = unionDateKeys(weekdays, ["2026-08-30"]); // a Sunday
    expect(merged).toContain("2026-08-30");
  });
});

describe("capGridKeys", () => {
  it("does not cap when under the cell budget", () => {
    const keys = Array.from({ length: 100 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`).slice(0, 20);
    const result = capGridKeys(keys, 50);
    expect(result).toEqual({ keys, capped: false });
  });

  it("keeps the LATEST keys that fit when over the cell budget", () => {
    // 200 learners x N dates must stay <= 10000, so N <= 50.
    const keys = Array.from({ length: 60 }, (_, i) => `d${String(i).padStart(2, "0")}`);
    const result = capGridKeys(keys, 200);
    expect(result.capped).toBe(true);
    expect(result.keys).toHaveLength(50);
    // The tail (latest) survives, the head (earliest) is dropped.
    expect(result.keys[0]).toBe("d10");
    expect(result.keys[result.keys.length - 1]).toBe("d59");
  });

  it("never caps an empty roster", () => {
    const keys = ["2026-08-24"];
    expect(capGridKeys(keys, 0)).toEqual({ keys, capped: false });
  });
});

describe("capNote", () => {
  it("names the school-day unit and the narrowing instruction", () => {
    expect(capNote(40, "school day")).toBe(
      "Showing the latest 40 school day(s); narrow the date range to see earlier days."
    );
  });

  it("names the period unit for the reading-level grid", () => {
    expect(capNote(12, "period")).toBe(
      "Showing the latest 12 period(s); narrow the date range to see earlier periods."
    );
  });
});
