import { describe, expect, it } from "vitest";
import {
  termGradesSaveSchema,
  termGradesExportSchema,
} from "@/lib/validators/term-grade.schema";

/**
 * The score range is 60-100 by explicit decision: 75 is DepEd's *passing* mark,
 * not its floor, and a 75 floor would make a failing learner unrecordable and
 * push teachers into entering a false 75. These tests pin the exact boundaries so
 * a later "tidy-up" to 75 fails loudly instead of silently.
 */

const LEARNING_AREAS = [
  "ENGLISH",
  "FILIPINO",
  "MATHEMATICS",
  "SCIENCE",
  "ARALING_PANLIPUNAN",
  "EDUKASYON_SA_PAGPAPAKATAO",
  "MAPEH",
  "TLE",
] as const;

const TERMS = ["FIRST", "SECOND", "THIRD"] as const;

const validEntry = {
  learnerId: "learner-1",
  subject: "ENGLISH" as const,
  score: 90,
};

const validSave = {
  gradeLevelId: "gl-7",
  term: "FIRST" as const,
  entries: [validEntry],
};

/** One save payload carrying a single score. */
function withScore(score: number | null) {
  return { ...validSave, entries: [{ ...validEntry, score }] };
}

describe("termGradesSaveSchema", () => {
  it("accepts a valid payload", () => {
    const result = termGradesSaveSchema.safeParse(validSave);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.entries[0].score).toBe(90);
    expect(result.data.term).toBe("FIRST");
  });

  it("enforces the score floor at 60, not DepEd's 75 passing mark", () => {
    expect(termGradesSaveSchema.safeParse(withScore(59)).success).toBe(false);
    expect(termGradesSaveSchema.safeParse(withScore(60)).success).toBe(true);
    // A failing learner must be recordable: everything between 60 and 75 is valid.
    expect(termGradesSaveSchema.safeParse(withScore(61)).success).toBe(true);
    expect(termGradesSaveSchema.safeParse(withScore(74)).success).toBe(true);
  });

  it("enforces the score ceiling at 100", () => {
    expect(termGradesSaveSchema.safeParse(withScore(100)).success).toBe(true);
    expect(termGradesSaveSchema.safeParse(withScore(101)).success).toBe(false);
  });

  it("accepts a null score — a cleared cell", () => {
    const result = termGradesSaveSchema.safeParse(withScore(null));
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Null must survive parsing: the action deletes the row for a cleared cell,
    // and coercing null to 0 here would write an out-of-range score instead.
    expect(result.data.entries[0].score).toBeNull();
  });

  it("rejects a non-integer score", () => {
    // DepEd quarterly grades are whole numbers, and the column is an Int.
    expect(termGradesSaveSchema.safeParse(withScore(85.5)).success).toBe(false);
    expect(termGradesSaveSchema.safeParse(withScore(99.999)).success).toBe(false);
  });

  it("accepts the eight learning areas and rejects anything else", () => {
    for (const subject of LEARNING_AREAS) {
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, subject }],
      });
      expect(result.success, `${subject} should be accepted`).toBe(true);
    }

    // "ARALPAN" and "TECHVOC" belong to the dead teacher-survey `Subject` enum;
    // this feature must not accept them.
    for (const subject of ["ARALPAN", "TECHVOC", "MUSIC", "english", ""]) {
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, subject }],
      });
      expect(result.success, `${subject} should be rejected`).toBe(false);
    }
  });

  it("accepts the three terms and rejects anything else", () => {
    for (const term of TERMS) {
      expect(termGradesSaveSchema.safeParse({ ...validSave, term }).success).toBe(true);
    }

    for (const term of ["FOURTH", "QUARTER_1", "first", ""]) {
      const result = termGradesSaveSchema.safeParse({ ...validSave, term });
      expect(result.success, `${term} should be rejected`).toBe(false);
    }
  });

  it("rejects an empty entries array", () => {
    // An empty batch would produce an audit row claiming a save that wrote
    // nothing; the grid only posts changed cells, so empty means a client bug.
    expect(termGradesSaveSchema.safeParse({ ...validSave, entries: [] }).success).toBe(
      false
    );
  });

  it("requires gradeLevelId, term and entries", () => {
    expect(
      termGradesSaveSchema.safeParse({ term: "FIRST", entries: [validEntry] }).success
    ).toBe(false);
    expect(
      termGradesSaveSchema.safeParse({ gradeLevelId: "gl-7", entries: [validEntry] })
        .success
    ).toBe(false);
    expect(
      termGradesSaveSchema.safeParse({ gradeLevelId: "gl-7", term: "FIRST" }).success
    ).toBe(false);
  });

  it("rejects blank ids", () => {
    expect(termGradesSaveSchema.safeParse({ ...validSave, gradeLevelId: "" }).success).toBe(
      false
    );
    expect(
      termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, learnerId: "" }],
      }).success
    ).toBe(false);
  });
});

describe("termGradesExportSchema", () => {
  it("accepts input with section and q omitted", () => {
    // Export from an unfiltered, unsearched sheet — the common case.
    const result = termGradesExportSchema.safeParse({
      gradeLevelId: "gl-7",
      term: "FIRST",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.section).toBeUndefined();
    expect(result.data.q).toBeUndefined();
  });

  it("accepts a section filter and a search term", () => {
    const result = termGradesExportSchema.safeParse({
      gradeLevelId: "gl-7",
      term: "THIRD",
      section: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      q: "santos",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown term and a missing gradeLevelId", () => {
    expect(
      termGradesExportSchema.safeParse({ gradeLevelId: "gl-7", term: "FOURTH" }).success
    ).toBe(false);
    expect(termGradesExportSchema.safeParse({ term: "FIRST" }).success).toBe(false);
  });
});
