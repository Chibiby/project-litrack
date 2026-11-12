import { describe, expect, it } from "vitest";
import {
  effectiveYearEnd,
  formatYearMonths,
  monthEnd,
  monthStart,
  parseMonthKey,
  toMonthKey,
} from "@/lib/school-year/months";

describe("school-year months", () => {
  it("parses only real months", () => {
    expect(parseMonthKey("2026-06")).toEqual([2026, 5]);
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-6")).toBeNull();
  });

  it("maps a month to its first and last day", () => {
    expect(monthStart("2026-06")).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(monthEnd("2028-02")).toEqual(new Date(Date.UTC(2028, 1, 29)));
    expect(toMonthKey(new Date(Date.UTC(2027, 3, 30)))).toBe("2027-04");
  });

  it("assumes a ten-month year when the end is not set", () => {
    const start = new Date(Date.UTC(2026, 5, 8));
    expect(effectiveYearEnd(start, null)).toEqual(new Date(Date.UTC(2027, 3, 30)));
    const end = new Date(Date.UTC(2027, 2, 31));
    expect(effectiveYearEnd(start, end)).toBe(end);
  });

  it("formats the range", () => {
    const start = new Date(Date.UTC(2026, 5, 1));
    expect(formatYearMonths(start, null)).toBe("Jun 2026 – end not set");
    expect(formatYearMonths(start, new Date(Date.UTC(2027, 3, 30)))).toBe("Jun 2026 – Apr 2027");
  });
});
