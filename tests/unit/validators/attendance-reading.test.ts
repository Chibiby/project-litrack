import { describe, expect, it } from "vitest";
import {
  attendanceMarkSchema,
  attendanceWeekSchema,
} from "@/lib/validators/attendance.schema";
import {
  readingLevelSchema,
  readingLevelBulkSchema,
  readingLevelMonthlyBulkSchema,
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

describe("attendanceWeekSchema", () => {
  const base = {
    gradeId: "grade-1",
    weekStart: "2026-08-10", // Monday
    cells: [
      { learnerId: "l1", date: "2026-08-10", status: "PRESENT" as const },
      {
        learnerId: "l2",
        date: "2026-08-11",
        status: "ABSENT" as const,
        notes: "Sick / Illness",
      },
    ],
  };

  it("accepts a week of cells, with and without a reason", () => {
    expect(attendanceWeekSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a null status — the cell means No Class, not absent", () => {
    expect(
      attendanceWeekSchema.safeParse({
        ...base,
        cells: [{ learnerId: "l1", date: "2026-08-10", status: null }],
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(
      attendanceWeekSchema.safeParse({
        ...base,
        cells: [{ learnerId: "l1", date: "2026-08-10", status: "TARDY" }],
      }).success,
    ).toBe(false);
  });

  it("requires YYYY-MM-DD date keys", () => {
    for (const date of ["2026-8-10", "10/08/2026", "2026-08-10T00:00:00Z", ""]) {
      expect(
        attendanceWeekSchema.safeParse({
          ...base,
          cells: [{ learnerId: "l1", date, status: "PRESENT" }],
        }).success,
      ).toBe(false);
    }
    expect(
      attendanceWeekSchema.safeParse({ ...base, weekStart: "2026-8-10" }).success,
    ).toBe(false);
  });

  it("rejects empty ids", () => {
    expect(attendanceWeekSchema.safeParse({ ...base, gradeId: "  " }).success).toBe(
      false,
    );
    expect(
      attendanceWeekSchema.safeParse({
        ...base,
        cells: [{ learnerId: "", date: "2026-08-10", status: "PRESENT" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a payload with nothing to save", () => {
    const res = attendanceWeekSchema.safeParse({ ...base, cells: [] });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toBe("Nothing to save");
    }
  });

  it("caps cells at 1400", () => {
    const cell = (i: number) => ({
      learnerId: `l${i}`,
      date: "2026-08-10",
      status: "PRESENT" as const,
    });
    expect(
      attendanceWeekSchema.safeParse({
        ...base,
        cells: Array.from({ length: 1400 }, (_, i) => cell(i)),
      }).success,
    ).toBe(true);
    expect(
      attendanceWeekSchema.safeParse({
        ...base,
        cells: Array.from({ length: 1401 }, (_, i) => cell(i)),
      }).success,
    ).toBe(false);
  });

  it("enforces the per-cell reason max length 500 and trims", () => {
    const cell = (notes: string) => ({
      ...base,
      cells: [
        { learnerId: "l1", date: "2026-08-25", status: "ABSENT" as const, notes },
      ],
    });

    expect(attendanceWeekSchema.safeParse(cell("x".repeat(500))).success).toBe(true);
    expect(attendanceWeekSchema.safeParse(cell("x".repeat(501))).success).toBe(false);

    const trimmed = attendanceWeekSchema.safeParse(cell("  Sick / Illness  "));
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.cells[0]?.notes).toBe("Sick / Illness");
    }
  });

  it("accepts a cell with no reason, and a reason explicitly cleared", () => {
    // `undefined` is "no reason" and `null` clears a stored one; both are how a
    // Present day and a cleared day travel.
    const omitted = attendanceWeekSchema.safeParse({
      ...base,
      cells: [{ learnerId: "l1", date: "2026-08-25", status: "PRESENT" }],
    });
    expect(omitted.success).toBe(true);

    const nulled = attendanceWeekSchema.safeParse({
      ...base,
      cells: [
        { learnerId: "l1", date: "2026-08-25", status: null, notes: null },
      ],
    });
    expect(nulled.success).toBe(true);
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

describe("readingLevelMonthlyBulkSchema", () => {
  const entry = {
    learnerId: "l1",
    englishProfile: "INSTRUCTIONAL_DEVELOPING" as const,
    filipinoProfile: "INDEPENDENT_GRADE_READY" as const,
    wordRecognitionLevel: "LEVEL_5" as const,
    readingComprehensionLevel: "LEVEL_1" as const,
  };

  it("normalizes monthStart to the 1st, so a month has one anchor", () => {
    // Every date in August has to land on the same row key, or two teachers
    // assessing on different days would create two rows for one month.
    for (const monthStart of ["2026-08-01", "2026-08-13", "2026-08-31"]) {
      const res = readingLevelMonthlyBulkSchema.safeParse({
        monthStart,
        entries: [entry],
      });
      expect(res.success).toBe(true);
      if (!res.success) continue;
      expect(res.data.monthStart.getFullYear()).toBe(2026);
      expect(res.data.monthStart.getMonth()).toBe(7);
      expect(res.data.monthStart.getDate()).toBe(1);
      expect(res.data.monthStart.getHours()).toBe(0);
    }
  });

  it("does not snap to Monday — that is the weekly schema's rule", () => {
    // August 1 2026 is a Saturday. The weekly schema would move it to July 27.
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-13",
      entries: [entry],
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.monthStart.getMonth()).toBe(7);
    expect(res.data.monthStart.getDate()).toBe(1);
  });

  it("accepts the same entry fields as the weekly bulk schema", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-01",
      entries: [{ ...entry, writingLevel: "LEVEL_2", notes: "  Reads aloud  " }],
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.entries[0]?.writingLevel).toBe("LEVEL_2");
    expect(res.data.entries[0]?.notes).toBe("Reads aloud");
  });

  it("treats an empty writing level as unset rather than invalid", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-01",
      entries: [{ ...entry, writingLevel: "" }],
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.entries[0]?.writingLevel).toBeUndefined();
  });

  it("rejects entries missing WR or RC", () => {
    expect(
      readingLevelMonthlyBulkSchema.safeParse({
        monthStart: "2026-08-01",
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

  it("rejects a payload with no entries", () => {
    expect(
      readingLevelMonthlyBulkSchema.safeParse({
        monthStart: "2026-08-01",
        entries: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a weekStart key — the monthly payload names its own period", () => {
    expect(
      readingLevelMonthlyBulkSchema.safeParse({
        weekStart: "2026-08-03",
        entries: [entry],
      }).success,
    ).toBe(false);
  });
});
