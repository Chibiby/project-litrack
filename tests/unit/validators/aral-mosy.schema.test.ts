import { describe, expect, it } from "vitest";
import { MOSY_REMARKS_MAX, aralMosyDecisionSchema } from "@/lib/validators/aral-mosy.schema";

const LEARNER = "3f0c8f0e-6a55-4c1e-9d55-0d3a6a1f2b10";
const base = { learnerId: LEARNER, mosyLevel: "INSTRUCTIONAL_DEVELOPING" };

function issuePaths(input: unknown): string[] {
  const r = aralMosyDecisionSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
}

describe("aralMosyDecisionSchema", () => {
  it("transforms empty decision, reason and remarks to null", () => {
    const r = aralMosyDecisionSchema.parse({ ...base, decision: "", reason: "", remarks: "" });
    expect(r).toEqual({
      learnerId: LEARNER,
      mosyLevel: "INSTRUCTIONAL_DEVELOPING",
      decision: null,
      reason: null,
      improvedToLevel: null,
      remarks: null,
    });
  });

  it("requires improvedToLevel for IMPROVED_READING_LEVEL, reported on reason", () => {
    const move = { ...base, decision: "MOVE_OUT", reason: "IMPROVED_READING_LEVEL" };
    expect(issuePaths(move)).toEqual(["reason"]);
    expect(issuePaths({ ...move, improvedToLevel: "" })).toEqual(["reason"]);
  });

  it("accepts IMPROVED_READING_LEVEL with an improvedToLevel", () => {
    const r = aralMosyDecisionSchema.parse({
      ...base,
      decision: "MOVE_OUT",
      reason: "IMPROVED_READING_LEVEL",
      improvedToLevel: "INDEPENDENT_GRADE_READY",
    });
    expect(r.reason).toBe("IMPROVED_READING_LEVEL");
    expect(r.improvedToLevel).toBe("INDEPENDENT_GRADE_READY");
  });

  it("does not require improvedToLevel for LSEN reasons and nulls a stray one", () => {
    const r = aralMosyDecisionSchema.parse({
      ...base,
      decision: "MOVE_OUT",
      reason: "DIAGNOSED_LSEN",
      improvedToLevel: "INDEPENDENT_GRADE_READY",
    });
    expect(r.improvedToLevel).toBeNull();
  });

  it("nulls improvedToLevel for STAY and deferred decisions", () => {
    for (const decision of ["STAY", ""]) {
      const r = aralMosyDecisionSchema.parse({
        ...base,
        decision,
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "INDEPENDENT_GRADE_READY",
      });
      expect(r.reason).toBeNull();
      expect(r.improvedToLevel).toBeNull();
    }
  });

  it("rejects an unknown improvedToLevel value", () => {
    expect(
      issuePaths({
        ...base,
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "GENIUS",
      })
    ).toContain("improvedToLevel");
  });

  it("still parses the legacy grouped reasons (grade rules live in resolveMosySave)", () => {
    const r = aralMosyDecisionSchema.parse({
      ...base,
      decision: "MOVE_OUT",
      reason: "IMPROVED_EARLY_GRADES",
    });
    expect(r.reason).toBe("IMPROVED_EARLY_GRADES");
    expect(r.improvedToLevel).toBeNull();
  });

  it("treats omitted optional fields like empty strings", () => {
    const r = aralMosyDecisionSchema.parse(base);
    expect(r.decision).toBeNull();
    expect(r.reason).toBeNull();
    expect(r.remarks).toBeNull();
  });

  it("trims remarks and nulls whitespace-only remarks", () => {
    expect(aralMosyDecisionSchema.parse({ ...base, remarks: "  hi  " }).remarks).toBe("hi");
    expect(aralMosyDecisionSchema.parse({ ...base, remarks: "   " }).remarks).toBeNull();
  });

  it("accepts remarks of exactly 250 characters", () => {
    const r = aralMosyDecisionSchema.safeParse({ ...base, remarks: "a".repeat(MOSY_REMARKS_MAX) });
    expect(MOSY_REMARKS_MAX).toBe(250);
    expect(r.success).toBe(true);
  });

  it("rejects remarks of 251 characters on remarks", () => {
    expect(issuePaths({ ...base, remarks: "a".repeat(251) })).toContain("remarks");
  });

  it("counts the cap after trimming (250 chars plus padding passes)", () => {
    expect(
      aralMosyDecisionSchema.safeParse({ ...base, remarks: ` ${"a".repeat(250)} ` }).success
    ).toBe(true);
  });

  it("rejects MOVE_OUT without a reason, on the reason field", () => {
    expect(issuePaths({ ...base, decision: "MOVE_OUT", reason: "" })).toEqual(["reason"]);
    expect(issuePaths({ ...base, decision: "MOVE_OUT" })).toEqual(["reason"]);
  });

  it("accepts MOVE_OUT with a reason", () => {
    const r = aralMosyDecisionSchema.parse({
      ...base,
      decision: "MOVE_OUT",
      reason: "DIAGNOSED_LSEN",
    });
    expect(r.decision).toBe("MOVE_OUT");
    expect(r.reason).toBe("DIAGNOSED_LSEN");
  });

  it("strips a reason submitted with STAY", () => {
    const r = aralMosyDecisionSchema.parse({ ...base, decision: "STAY", reason: "DIAGNOSED_LSEN" });
    expect(r.reason).toBeNull();
  });

  it("strips a reason submitted with a deferred decision", () => {
    const r = aralMosyDecisionSchema.parse({ ...base, decision: "", reason: "DIAGNOSED_LSEN" });
    expect(r.reason).toBeNull();
  });

  it("rejects unknown enum values", () => {
    expect(issuePaths({ ...base, mosyLevel: "GENIUS" })).toContain("mosyLevel");
    expect(issuePaths({ ...base, decision: "MAYBE" })).toContain("decision");
    expect(issuePaths({ ...base, decision: "STAY", reason: "BORED" })).toContain("reason");
  });

  it("requires a MOSY level", () => {
    expect(issuePaths({ learnerId: LEARNER })).toContain("mosyLevel");
    expect(issuePaths({ learnerId: LEARNER, mosyLevel: "" })).toContain("mosyLevel");
  });

  it("rejects a non-uuid learner id", () => {
    expect(issuePaths({ ...base, learnerId: "learner-1" })).toContain("learnerId");
  });
});
