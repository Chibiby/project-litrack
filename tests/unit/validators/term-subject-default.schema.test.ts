import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_SUBJECTS_PER_GRADE, TERM_SHEET_GRADE_TYPES } from "@/lib/terms/subjects";
import {
  createTermSubjectDefaultSchema,
  renameTermSubjectDefaultSchema,
  reorderTermSubjectDefaultsSchema,
  termSubjectDefaultIdSchema,
} from "@/lib/validators/term-subject-default.schema";

/**
 * Super Admin per-`GradeLevelType` template payloads. None carries a
 * `schoolId` — `TermSubjectDefault` is tenant-less, scoped only by
 * `gradeLevelType`. `FLOATING` must be refused here, before any query runs.
 */

describe("createTermSubjectDefaultSchema", () => {
  it("accepts a TERM_SHEET_GRADE_TYPES value and a name", () => {
    const result = createTermSubjectDefaultSchema.safeParse({
      gradeLevelType: "G7",
      name: "Reading Enrichment",
    });
    expect(result.success).toBe(true);
  });

  it("refuses FLOATING before any query runs", () => {
    const result = createTermSubjectDefaultSchema.safeParse({
      gradeLevelType: "FLOATING",
      name: "English",
    });
    expect(result.success).toBe(false);
  });

  it("refuses KINDER — Kindergarten's report is the fixed competency checklist, not a subject template", () => {
    const result = createTermSubjectDefaultSchema.safeParse({
      gradeLevelType: "KINDER",
      name: "English",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown grade level type", () => {
    const result = createTermSubjectDefaultSchema.safeParse({
      gradeLevelType: "G13",
      name: "English",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing or blank name", () => {
    expect(
      createTermSubjectDefaultSchema.safeParse({ gradeLevelType: "G7" }).success
    ).toBe(false);
    expect(
      createTermSubjectDefaultSchema.safeParse({ gradeLevelType: "G7", name: "" }).success
    ).toBe(false);
  });

  it("accepts every TERM_SHEET_GRADE_TYPES value", () => {
    for (const gradeLevelType of TERM_SHEET_GRADE_TYPES) {
      const result = createTermSubjectDefaultSchema.safeParse({
        gradeLevelType,
        name: "English",
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("renameTermSubjectDefaultSchema", () => {
  it("accepts an id and a name", () => {
    expect(
      renameTermSubjectDefaultSchema.safeParse({ id: "default-1", name: "Mathematics" })
        .success
    ).toBe(true);
  });

  it("rejects a missing id or an invalid name", () => {
    expect(
      renameTermSubjectDefaultSchema.safeParse({ name: "Mathematics" }).success
    ).toBe(false);
    expect(
      renameTermSubjectDefaultSchema.safeParse({ id: "default-1", name: "" }).success
    ).toBe(false);
  });
});

describe("termSubjectDefaultIdSchema", () => {
  it("accepts a bare id — archive/restore payload shape", () => {
    expect(termSubjectDefaultIdSchema.safeParse({ id: "default-1" }).success).toBe(true);
  });

  it("rejects a missing or blank id", () => {
    expect(termSubjectDefaultIdSchema.safeParse({}).success).toBe(false);
    expect(termSubjectDefaultIdSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("reorderTermSubjectDefaultsSchema", () => {
  it("accepts a gradeLevelType and a non-empty list of ids up to the cap", () => {
    const result = reorderTermSubjectDefaultsSchema.safeParse({
      gradeLevelType: "G7",
      orderedIds: Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) => `d-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it("refuses FLOATING", () => {
    const result = reorderTermSubjectDefaultsSchema.safeParse({
      gradeLevelType: "FLOATING",
      orderedIds: ["d-1"],
    });
    expect(result.success).toBe(false);
  });

  it("refuses KINDER", () => {
    const result = reorderTermSubjectDefaultsSchema.safeParse({
      gradeLevelType: "KINDER",
      orderedIds: ["d-1"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty orderedIds array", () => {
    expect(
      reorderTermSubjectDefaultsSchema.safeParse({ gradeLevelType: "G7", orderedIds: [] })
        .success
    ).toBe(false);
  });

  it("rejects a list longer than MAX_ACTIVE_SUBJECTS_PER_GRADE", () => {
    const result = reorderTermSubjectDefaultsSchema.safeParse({
      gradeLevelType: "G7",
      orderedIds: Array.from(
        { length: MAX_ACTIVE_SUBJECTS_PER_GRADE + 1 },
        (_, i) => `d-${i}`
      ),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank id inside orderedIds", () => {
    const result = reorderTermSubjectDefaultsSchema.safeParse({
      gradeLevelType: "G7",
      orderedIds: ["d-1", ""],
    });
    expect(result.success).toBe(false);
  });
});
