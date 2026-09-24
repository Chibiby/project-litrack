import { describe, expect, it } from "vitest";
import { classifyReadingMovement } from "@/lib/summary/shape/reading-movement";

/** T16, Q4 default: improved = higher level; declined is separate from "no improvement". */
describe("classifyReadingMovement", () => {
  it("improved: a higher band than last month", () => {
    expect(classifyReadingMovement("FRUSTRATION_HIGH_EMERGENT", "INSTRUCTIONAL_DEVELOPING", "G4")).toBe(
      "improved"
    );
  });

  it("same: the same band", () => {
    expect(classifyReadingMovement("INSTRUCTIONAL_DEVELOPING", "INSTRUCTIONAL_DEVELOPING", "G4")).toBe(
      "same"
    );
  });

  it("declined: a lower band, never folded into same", () => {
    expect(classifyReadingMovement("INDEPENDENT_GRADE_READY", "NON_DECODER_LOW_EMERGENT", "G4")).toBe(
      "declined"
    );
  });

  it("ranks Kinder on its letter rubric", () => {
    expect(classifyReadingMovement("LETTER_LEVEL", "CV_BLENDING", "KINDER")).toBe("improved");
    expect(classifyReadingMovement("CVC_BLENDING", "CANNOT_NAME_SOUND_LETTERS", "KINDER")).toBe("declined");
  });

  it("not comparable: a promoted Kinder learner's rubric value on Grade 1's scale", () => {
    expect(classifyReadingMovement("CVC_BLENDING", "FRUSTRATION_HIGH_EMERGENT", "G1")).toBe(
      "not_comparable"
    );
  });

  it("not comparable: Non-decoder is not on the Grade 11/12 scale", () => {
    expect(classifyReadingMovement("NON_DECODER_LOW_EMERGENT", "FRUSTRATION_HIGH_EMERGENT", "G11")).toBe(
      "not_comparable"
    );
  });
});
