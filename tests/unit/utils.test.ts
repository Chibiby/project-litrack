import { describe, expect, it } from "vitest";
import { getMonday, monthYearKey } from "@/lib/utils";

describe("getMonday", () => {
  it("returns the Monday of the week containing the given date", () => {
    // 2026-08-06 is a Thursday → Monday is 2026-08-03
    const thursday = new Date(2026, 7, 6);
    const monday = getMonday(thursday);
    expect(monday.getFullYear()).toBe(2026);
    expect(monday.getMonth()).toBe(7);
    expect(monday.getDate()).toBe(3);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
  });

  it("keeps Monday as-is and maps Sunday back to prior Monday", () => {
    const monday = new Date(2026, 7, 3);
    expect(getMonday(monday).getDate()).toBe(3);

    // 2026-08-09 is a Sunday → Monday is 2026-08-03
    const sunday = new Date(2026, 7, 9);
    const result = getMonday(sunday);
    expect(result.getDate()).toBe(3);
    expect(result.getDay()).toBe(1);
  });
});

describe("monthYearKey", () => {
  it("formats YYYY-MM with zero-padded month", () => {
    expect(monthYearKey(new Date(2026, 7, 6))).toBe("2026-08");
    expect(monthYearKey(new Date(2026, 0, 1))).toBe("2026-01");
    expect(monthYearKey(new Date(2025, 11, 31))).toBe("2025-12");
  });
});
