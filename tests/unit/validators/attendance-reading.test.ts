import { describe, expect, it } from "vitest";
import { attendanceMarkSchema } from "@/lib/validators/attendance.schema";
import { readingLevelSchema } from "@/lib/validators/reading-level.schema";

describe("attendanceMarkSchema", () => {
  const base = {
    learnerId: "learner-1",
    date: "2026-08-06",
    status: "PRESENT" as const,
  };

  it("accepts status enum values and rejects others", () => {
    for (const status of ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const) {
      expect(attendanceMarkSchema.safeParse({ ...base, status }).success).toBe(true);
    }
    expect(attendanceMarkSchema.safeParse({ ...base, status: "TARDY" }).success).toBe(false);
  });

  it("enforces notes max length 500", () => {
    expect(
      attendanceMarkSchema.safeParse({ ...base, notes: "x".repeat(500) }).success,
    ).toBe(true);
    expect(
      attendanceMarkSchema.safeParse({ ...base, notes: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("readingLevelSchema", () => {
  const base = {
    learnerId: "learner-1",
    monthYear: "2026-08",
    englishProfile: "INSTRUCTIONAL_DEVELOPING" as const,
    filipinoProfile: "FRUSTRATION_HIGH_EMERGENT" as const,
  };

  it("accepts monthYear YYYY-MM and rejects invalid formats", () => {
    expect(readingLevelSchema.safeParse(base).success).toBe(true);
    expect(readingLevelSchema.safeParse({ ...base, monthYear: "2026-8" }).success).toBe(false);
    expect(readingLevelSchema.safeParse({ ...base, monthYear: "abc" }).success).toBe(false);
    expect(readingLevelSchema.safeParse({ ...base, monthYear: "26-08" }).success).toBe(false);
  });
});
