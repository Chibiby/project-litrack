import { describe, expect, it } from "vitest";
import {
  attendanceMarkSchema,
  attendanceBulkSchema,
} from "@/lib/validators/attendance.schema";
import {
  readingLevelSchema,
  readingLevelBulkSchema,
} from "@/lib/validators/reading-level.schema";

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

describe("attendanceBulkSchema", () => {
  it("accepts a date with one or more entry rows", () => {
    const ok = attendanceBulkSchema.safeParse({
      date: "2026-08-06",
      entries: [
        { learnerId: "l1", status: "PRESENT" },
        { learnerId: "l2", status: "ABSENT", notes: "Sick" },
      ],
    });
    expect(ok.success).toBe(true);

    expect(
      attendanceBulkSchema.safeParse({ date: "2026-08-06", entries: [] }).success,
    ).toBe(false);
  });
});

describe("readingLevelSchema", () => {
  const base = {
    learnerId: "learner-1",
    weekStart: "2026-08-03", // Monday
    englishProfile: "INSTRUCTIONAL_DEVELOPING" as const,
    filipinoProfile: "FRUSTRATION_HIGH_EMERGENT" as const,
    wordRecognitionLevel: "LEVEL_3" as const,
    readingComprehensionLevel: "LEVEL_2" as const,
  };

  it("normalizes weekStart to Monday", () => {
    const wednesday = readingLevelSchema.safeParse({
      ...base,
      weekStart: "2026-08-05", // Wednesday → Monday Aug 3
    });
    expect(wednesday.success).toBe(true);
    if (!wednesday.success) return;
    expect(wednesday.data.weekStart.getDay()).toBe(1);
    expect(wednesday.data.weekStart.getFullYear()).toBe(2026);
    expect(wednesday.data.weekStart.getMonth()).toBe(7);
    expect(wednesday.data.weekStart.getDate()).toBe(3);
  });

  it("rejects invalid reading profiles", () => {
    expect(
      readingLevelSchema.safeParse({ ...base, englishProfile: "UNKNOWN" }).success,
    ).toBe(false);
  });

  it("requires wordRecognitionLevel and readingComprehensionLevel", () => {
    const { wordRecognitionLevel: _wr, readingComprehensionLevel: _rc, ...without } =
      base;
    expect(readingLevelSchema.safeParse(without).success).toBe(false);
    expect(
      readingLevelSchema.safeParse({
        ...base,
        wordRecognitionLevel: undefined,
      }).success,
    ).toBe(false);
    expect(
      readingLevelSchema.safeParse({
        ...base,
        readingComprehensionLevel: undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts WR L1–L5, L0, NA and RC L1–L3, L0, NA", () => {
    for (const wordRecognitionLevel of [
      "LEVEL_1",
      "LEVEL_2",
      "LEVEL_3",
      "LEVEL_4",
      "LEVEL_5",
      "LEVEL_0",
      "NA",
    ] as const) {
      expect(
        readingLevelSchema.safeParse({ ...base, wordRecognitionLevel }).success,
      ).toBe(true);
    }
    for (const readingComprehensionLevel of [
      "LEVEL_1",
      "LEVEL_2",
      "LEVEL_3",
      "LEVEL_0",
      "NA",
    ] as const) {
      expect(
        readingLevelSchema.safeParse({ ...base, readingComprehensionLevel })
          .success,
      ).toBe(true);
    }
    expect(
      readingLevelSchema.safeParse({
        ...base,
        wordRecognitionLevel: "LEVEL_6",
      }).success,
    ).toBe(false);
    expect(
      readingLevelSchema.safeParse({
        ...base,
        readingComprehensionLevel: "LEVEL_4",
      }).success,
    ).toBe(false);
  });
});

describe("readingLevelBulkSchema", () => {
  it("accepts weekStart with entry rows including WR and RC", () => {
    const ok = readingLevelBulkSchema.safeParse({
      weekStart: "2026-08-06",
      entries: [
        {
          learnerId: "l1",
          englishProfile: "INSTRUCTIONAL_DEVELOPING",
          filipinoProfile: "INDEPENDENT_GRADE_READY",
          wordRecognitionLevel: "LEVEL_5",
          readingComprehensionLevel: "LEVEL_1",
        },
      ],
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.weekStart.getDay()).toBe(1);
  });

  it("rejects bulk entries missing WR or RC", () => {
    expect(
      readingLevelBulkSchema.safeParse({
        weekStart: "2026-08-06",
        entries: [
          {
            learnerId: "l1",
            englishProfile: "INSTRUCTIONAL_DEVELOPING",
            filipinoProfile: "INDEPENDENT_GRADE_READY",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
