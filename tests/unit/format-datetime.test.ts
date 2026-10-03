import { describe, expect, it } from "vitest";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";
import { formatSchoolDate, formatSchoolDateTime } from "@/lib/format-datetime";

const INSTANT = "2026-10-05T17:30:00Z";

describe("format-datetime", () => {
  it("pins the school zone to Asia/Manila", () => {
    expect(SCHOOL_TIME_ZONE).toBe("Asia/Manila");
  });

  it("formatSchoolDate rolls a late-UTC instant into the next Manila day", () => {
    expect(formatSchoolDate(INSTANT)).toBe("Oct 6, 2026");
  });

  it("formatSchoolDateTime shows Manila wall-clock time", () => {
    expect(formatSchoolDateTime(INSTANT)).toMatch(/^Oct 6, 2026, 1:30\sAM$/);
  });

  it("accepts Date and epoch inputs identically", () => {
    const ms = Date.parse(INSTANT);
    expect(formatSchoolDateTime(new Date(ms))).toBe(formatSchoolDateTime(INSTANT));
    expect(formatSchoolDateTime(ms)).toBe(formatSchoolDateTime(INSTANT));
  });
});
