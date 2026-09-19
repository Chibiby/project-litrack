import { describe, it, expect } from "vitest";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { DASHBOARD_QUOTES, pickQuote } from "@/lib/dashboard/quotes";
import { buildMonthGrid } from "@/lib/dashboard/month-grid";

describe("teacherBannerSrc", () => {
  it("uses the male banner for MALE", () => {
    expect(teacherBannerSrc("MALE")).toBe("/brand/banner-teacher-male.webp");
  });
  it.each(["FEMALE", null, undefined] as const)("uses the female banner for %s", (g) => {
    expect(teacherBannerSrc(g)).toBe("/brand/banner-teacher-female.webp");
  });
});

describe("pickQuote", () => {
  it("has several attributed quotes", () => {
    expect(DASHBOARD_QUOTES.length).toBeGreaterThanOrEqual(8);
    for (const q of DASHBOARD_QUOTES) {
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.author.length).toBeGreaterThan(0);
    }
  });
  it("maps the random source onto the list", () => {
    expect(pickQuote(() => 0)).toBe(DASHBOARD_QUOTES[0]);
    expect(pickQuote(() => 0.9999)).toBe(DASHBOARD_QUOTES[DASHBOARD_QUOTES.length - 1]);
  });
});

describe("buildMonthGrid", () => {
  it("lays out September 2026 starting on Tuesday and marks today", () => {
    const g = buildMonthGrid("2026-09-13");
    expect(g.monthLabel).toBe("September 2026");
    expect(g.weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(g.weeks[0][2]).toEqual({ day: 1, key: "2026-09-01", isToday: false });
    const today = g.weeks.flat().find((c) => c?.isToday);
    expect(today).toEqual({ day: 13, key: "2026-09-13", isToday: true });
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });
});
