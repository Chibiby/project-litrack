import { describe, expect, it } from "vitest";
import { getMonday, monthYearKey } from "./utils";

describe("getMonday", () => {
  it("returns Monday for a mid-week date", () => {
    // Wednesday 2024-01-10 local
    const wed = new Date(2024, 0, 10, 15, 30, 0);
    const monday = getMonday(wed);
    expect(monday.getFullYear()).toBe(2024);
    expect(monday.getMonth()).toBe(0);
    expect(monday.getDate()).toBe(8);
    expect(monday.getHours()).toBe(0);
  });

  it("returns the same day when already Monday", () => {
    const mon = new Date(2024, 0, 8, 9, 0, 0);
    const result = getMonday(mon);
    expect(result.getDate()).toBe(8);
  });

  it("rolls back Sunday to the previous Monday", () => {
    const sun = new Date(2024, 0, 14, 12, 0, 0);
    const monday = getMonday(sun);
    expect(monday.getDate()).toBe(8);
  });
});

describe("monthYearKey", () => {
  it("formats YYYY-MM with zero-padded month", () => {
    expect(monthYearKey(new Date(2024, 0, 5))).toBe("2024-01");
    expect(monthYearKey(new Date(2024, 11, 31))).toBe("2024-12");
  });
});
