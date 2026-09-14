import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_SUBJECTS_PER_GRADE } from "@/lib/terms/subjects";
import {
  createTermSubjectSchema,
  renameTermSubjectSchema,
  reorderTermSubjectsSchema,
  termSubjectGradeSchema,
  termSubjectIdSchema,
  termSubjectNameSchema,
} from "@/lib/validators/term-subject.schema";

/**
 * None of these payloads carries a `schoolId` — the school is always derived
 * server-side from the target grade or subject row (§0, §5 of the design). A
 * schema that accepted one would be an attack surface the action never reads,
 * which is worse than useless, so there is no test asserting it is accepted —
 * only that the shapes below are exactly what is required.
 */

describe("termSubjectNameSchema", () => {
  it("trims surrounding whitespace", () => {
    const result = termSubjectNameSchema.safeParse("  English  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("English");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(termSubjectNameSchema.safeParse("").success).toBe(false);
    expect(termSubjectNameSchema.safeParse("   ").success).toBe(false);
  });

  it("accepts exactly 60 characters and rejects 61", () => {
    expect(termSubjectNameSchema.safeParse("a".repeat(60)).success).toBe(true);
    expect(termSubjectNameSchema.safeParse("a".repeat(61)).success).toBe(false);
  });

  it("rejects control characters (C0 and DEL), by code point", () => {
    expect(termSubjectNameSchema.safeParse(String.fromCharCode(69,110,103,108,105,115,104,0)).success).toBe(false);
    expect(termSubjectNameSchema.safeParse(String.fromCharCode(69,110,103,108,105,115,104,31)).success).toBe(false);
    expect(termSubjectNameSchema.safeParse(String.fromCharCode(69,110,103,108,105,115,104,127)).success).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(termSubjectNameSchema.safeParse(42).success).toBe(false);
    expect(termSubjectNameSchema.safeParse(null).success).toBe(false);
    expect(termSubjectNameSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("createTermSubjectSchema", () => {
  it("accepts a gradeLevelId and a name", () => {
    const result = createTermSubjectSchema.safeParse({
      gradeLevelId: "grade-1",
      name: "Reading Enrichment",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing or blank gradeLevelId", () => {
    expect(createTermSubjectSchema.safeParse({ name: "English" }).success).toBe(false);
    expect(
      createTermSubjectSchema.safeParse({ gradeLevelId: "", name: "English" }).success
    ).toBe(false);
  });

  it("ignores an extraneous schoolId in the payload rather than requiring or forwarding it", () => {
    // Zod's default (non-strict) object parsing strips unknown keys; the school
    // is derived server-side regardless of what a hand-made payload carries.
    const result = createTermSubjectSchema.safeParse({
      gradeLevelId: "grade-1",
      name: "English",
      schoolId: "school-should-be-ignored",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("schoolId");
    }
  });
});

describe("renameTermSubjectSchema", () => {
  it("accepts an id and a name", () => {
    expect(
      renameTermSubjectSchema.safeParse({ id: "subj-1", name: "Mathematics" }).success
    ).toBe(true);
  });

  it("rejects a missing id or an invalid name", () => {
    expect(renameTermSubjectSchema.safeParse({ name: "Mathematics" }).success).toBe(false);
    expect(renameTermSubjectSchema.safeParse({ id: "subj-1", name: "" }).success).toBe(
      false
    );
  });
});

describe("termSubjectIdSchema", () => {
  it("accepts a bare id — archive and restore payload shape", () => {
    expect(termSubjectIdSchema.safeParse({ id: "subj-1" }).success).toBe(true);
  });

  it("rejects a missing or blank id", () => {
    expect(termSubjectIdSchema.safeParse({}).success).toBe(false);
    expect(termSubjectIdSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("termSubjectGradeSchema", () => {
  it("accepts a bare gradeLevelId — the management-page load payload", () => {
    expect(termSubjectGradeSchema.safeParse({ gradeLevelId: "grade-1" }).success).toBe(
      true
    );
  });

  it("rejects a missing gradeLevelId", () => {
    expect(termSubjectGradeSchema.safeParse({}).success).toBe(false);
  });
});

describe("reorderTermSubjectsSchema", () => {
  it("accepts a gradeLevelId and a non-empty list of ids up to the cap", () => {
    const result = reorderTermSubjectsSchema.safeParse({
      gradeLevelId: "grade-1",
      orderedIds: Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) => `s-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty orderedIds array", () => {
    expect(
      reorderTermSubjectsSchema.safeParse({ gradeLevelId: "grade-1", orderedIds: [] })
        .success
    ).toBe(false);
  });

  it("rejects a list longer than MAX_ACTIVE_SUBJECTS_PER_GRADE", () => {
    const result = reorderTermSubjectsSchema.safeParse({
      gradeLevelId: "grade-1",
      orderedIds: Array.from(
        { length: MAX_ACTIVE_SUBJECTS_PER_GRADE + 1 },
        (_, i) => `s-${i}`
      ),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank id inside orderedIds", () => {
    const result = reorderTermSubjectsSchema.safeParse({
      gradeLevelId: "grade-1",
      orderedIds: ["s-1", ""],
    });
    expect(result.success).toBe(false);
  });
});
