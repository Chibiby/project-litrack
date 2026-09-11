process.env.TZ = "Asia/Manila";

import { describe, expect, it } from "vitest";
import {
  readingLevelSchema,
  readingLevelMonthlyBulkSchema,
} from "@/lib/validators/reading-level.schema";

/**
 * The asymmetry `reading-level.schema.ts` documents at length: the single-
 * learner form (`readingLevelSchema`) still rejects a blank field — one
 * deliberate assessment, filled in one sitting — while the monthly bulk grid
 * accepts a partially-filled row, because the grid is a sheet a teacher
 * revisits over days.
 */

function entry(learnerId: string, overrides: Record<string, unknown> = {}) {
  return {
    learnerId,
    englishProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_3",
    readingComprehensionLevel: "LEVEL_2",
    ...overrides,
  };
}

describe("readingLevelMonthlyBulkSchema — partial rows", () => {
  it("accepts a two-field partial row", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [
        {
          learnerId: "learner-a",
          englishProfile: "INSTRUCTIONAL_DEVELOPING",
          filipinoProfile: "INDEPENDENT_GRADE_READY",
        },
      ],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.entries[0].wordRecognitionLevel).toBeUndefined();
    expect(res.data.entries[0].readingComprehensionLevel).toBeUndefined();
  });

  it("rejects an entry with all six fields absent, with the exact message", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [{ learnerId: "learner-a" }],
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.errors[0]?.message).toBe("An empty row must be cleared, not saved");
  });

  it("treats an empty string the same as an absent field", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [
        {
          learnerId: "learner-a",
          englishProfile: "",
          filipinoProfile: "",
          wordRecognitionLevel: "",
          readingComprehensionLevel: "",
          writingLevel: "",
          notes: "",
        },
      ],
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.errors[0]?.message).toBe("An empty row must be cleared, not saved");
  });
});

describe("readingLevelMonthlyBulkSchema — entries and clears", () => {
  it("parses entries: [], clears: ['l1']", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [],
      clears: ["l1"],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.clears).toEqual(["l1"]);
    expect(res.data.entries).toEqual([]);
  });

  it("fails entries: [], clears: [] — nothing to save", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [],
      clears: [],
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.errors[0]?.message).toBe("Nothing to save");
  });

  it("defaults clears to [] when omitted, and still requires something to save", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [],
    });

    expect(res.success).toBe(false);
  });

  it("rejects a learner id present in both entries and clears", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [entry("learner-a")],
      clears: ["learner-a"],
    });

    expect(res.success).toBe(false);
  });

  it("accepts a normal fully-filled entry alongside a distinct clear", () => {
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries: [entry("learner-a")],
      clears: ["learner-b"],
    });

    expect(res.success).toBe(true);
  });

  it("still caps entries at 200", () => {
    const entries = Array.from({ length: 201 }, (_, i) => entry(`learner-${i}`));
    const res = readingLevelMonthlyBulkSchema.safeParse({
      monthStart: "2026-08-15",
      entries,
    });

    expect(res.success).toBe(false);
  });
});

describe("readingLevelSchema — the single-record form is unchanged", () => {
  it("still REJECTS a missing englishProfile", () => {
    const res = readingLevelSchema.safeParse({
      learnerId: "learner-a",
      weekStart: "2026-08-10",
      filipinoProfile: "INDEPENDENT_GRADE_READY",
      wordRecognitionLevel: "LEVEL_3",
      readingComprehensionLevel: "LEVEL_2",
    });

    expect(res.success).toBe(false);
  });

  it("accepts a fully-filled single record", () => {
    const res = readingLevelSchema.safeParse({
      learnerId: "learner-a",
      weekStart: "2026-08-10",
      englishProfile: "INSTRUCTIONAL_DEVELOPING",
      filipinoProfile: "INDEPENDENT_GRADE_READY",
      wordRecognitionLevel: "LEVEL_3",
      readingComprehensionLevel: "LEVEL_2",
    });

    expect(res.success).toBe(true);
  });
});
