import { describe, expect, it } from "vitest";
import { monthBounds, weekBounds } from "@/lib/dashboard/aggregates";

describe("weekBounds", () => {
  it("starts on Monday local midnight", () => {
    // Wed 13 May 2026, 14:30 local
    const { start } = weekBounds(new Date(2026, 4, 13, 14, 30));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(11);
    expect(start.getHours()).toBe(0);
  });

  it("treats Sunday as the end of the week that began the prior Monday", () => {
    const { start, end } = weekBounds(new Date(2026, 4, 17, 9, 0)); // Sunday
    expect(start.getDate()).toBe(11);
    expect(end.getDate()).toBe(18); // exclusive next Monday
  });

  it("counts weekdays elapsed including today, capped at 5", () => {
    expect(weekBounds(new Date(2026, 4, 11)).schoolDaysElapsed).toBe(1); // Mon
    expect(weekBounds(new Date(2026, 4, 13)).schoolDaysElapsed).toBe(3); // Wed
    expect(weekBounds(new Date(2026, 4, 16)).schoolDaysElapsed).toBe(5); // Sat
    expect(weekBounds(new Date(2026, 4, 17)).schoolDaysElapsed).toBe(5); // Sun
  });
});

describe("monthBounds", () => {
  it("spans the local calendar month, end-exclusive", () => {
    const { start, end } = monthBounds(new Date(2026, 4, 13, 23, 59));
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(1);
  });

  it("rolls over the year in December", () => {
    const { end } = monthBounds(new Date(2026, 11, 20));
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
  });
});
