import { describe, expect, it } from "vitest";
import { computeReadingLevelStats } from "@/lib/aral/reading-level-stats";

// G4-G10/FLOATING scale (readingProfileOptionsForGrade("G5")), low to high:
// NON_DECODER_LOW_EMERGENT, FRUSTRATION_HIGH_EMERGENT,
// INSTRUCTIONAL_DEVELOPING, INDEPENDENT_GRADE_READY (indices 0-3).
const GRADE_TYPE = "G5";

describe("computeReadingLevelStats", () => {
  it("computes a normal month", () => {
    const stats = computeReadingLevelStats({
      total: 10,
      completed: 6,
      records: [
        { englishProfile: "INSTRUCTIONAL_DEVELOPING", filipinoProfile: "INSTRUCTIONAL_DEVELOPING" },
      ],
      gradeType: GRADE_TYPE,
    });

    expect(stats.total).toBe(10);
    expect(stats.assessed).toBe(6);
    expect(stats.pending).toBe(4);
    expect(stats.completionPct).toBe(60);
    expect(stats.averageLabel).toBe("Instructional");
  });

  it("nobody assessed: averageLabel is null, completionPct is 0, nothing is NaN", () => {
    const stats = computeReadingLevelStats({
      total: 10,
      completed: 0,
      records: [],
      gradeType: GRADE_TYPE,
    });

    expect(stats.completionPct).toBe(0);
    expect(stats.averageLabel).toBeNull();
    expect(stats.pending).toBe(10);
    expect(Number.isNaN(stats.completionPct)).toBe(false);
  });

  it("everyone assessed: 100% completion", () => {
    const stats = computeReadingLevelStats({
      total: 4,
      completed: 4,
      records: [
        { englishProfile: "INDEPENDENT_GRADE_READY", filipinoProfile: "INDEPENDENT_GRADE_READY" },
        { englishProfile: "INDEPENDENT_GRADE_READY", filipinoProfile: "INDEPENDENT_GRADE_READY" },
        { englishProfile: "INDEPENDENT_GRADE_READY", filipinoProfile: "INDEPENDENT_GRADE_READY" },
        { englishProfile: "INDEPENDENT_GRADE_READY", filipinoProfile: "INDEPENDENT_GRADE_READY" },
      ],
      gradeType: GRADE_TYPE,
    });

    expect(stats.completionPct).toBe(100);
    expect(stats.pending).toBe(0);
    expect(stats.averageLabel).toBe("Independent");
  });

  it("pending never negative and completionPct never exceeds 100 when completed somehow exceeds total", () => {
    const stats = computeReadingLevelStats({
      total: 3,
      completed: 5,
      records: [],
      gradeType: GRADE_TYPE,
    });

    expect(stats.pending).toBe(0);
    expect(stats.pending).toBeGreaterThanOrEqual(0);
    // 5/3 * 100 = 167 unclamped; must read 100, not 167.
    expect(stats.completionPct).toBe(100);
    expect(stats.completionPct).toBeLessThanOrEqual(100);
  });

  it("rounds the average to the nearer rubric value when it lands between two", () => {
    // Two learners: one at index 1 (FRUSTRATION_HIGH_EMERGENT), one at index 2
    // (INSTRUCTIONAL_DEVELOPING). Mean of per-learner ranks = (1 + 2) / 2 = 1.5,
    // which Math.round rounds up to index 2 -> "Instructional".
    const stats = computeReadingLevelStats({
      total: 2,
      completed: 2,
      records: [
        { englishProfile: "FRUSTRATION_HIGH_EMERGENT", filipinoProfile: "FRUSTRATION_HIGH_EMERGENT" },
        { englishProfile: "INSTRUCTIONAL_DEVELOPING", filipinoProfile: "INSTRUCTIONAL_DEVELOPING" },
      ],
      gradeType: GRADE_TYPE,
    });

    expect(stats.averageLabel).toBe("Instructional");
  });

  it("rounds down when the average sits closer to the lower rubric value", () => {
    // Three learners at index 0, one at index 3: mean = (0+0+0+3)/4 = 0.75 -> round -> 1 ("Frustration").
    const stats = computeReadingLevelStats({
      total: 4,
      completed: 4,
      records: [
        { englishProfile: "NON_DECODER_LOW_EMERGENT", filipinoProfile: "NON_DECODER_LOW_EMERGENT" },
        { englishProfile: "NON_DECODER_LOW_EMERGENT", filipinoProfile: "NON_DECODER_LOW_EMERGENT" },
        { englishProfile: "NON_DECODER_LOW_EMERGENT", filipinoProfile: "NON_DECODER_LOW_EMERGENT" },
        { englishProfile: "INDEPENDENT_GRADE_READY", filipinoProfile: "INDEPENDENT_GRADE_READY" },
      ],
      gradeType: GRADE_TYPE,
    });

    expect(stats.averageLabel).toBe("Frustration");
  });

  it("ignores values outside the grade's scale", () => {
    // G11/G12 scale is the restricted SHS three (no NON_DECODER_LOW_EMERGENT).
    // A legacy value not on this grade's scale must be ignored entirely, not
    // coerced into a rank — leaving only the one valid record to average.
    const stats = computeReadingLevelStats({
      total: 2,
      completed: 1,
      records: [
        { englishProfile: "NON_DECODER_LOW_EMERGENT", filipinoProfile: "NON_DECODER_LOW_EMERGENT" },
        { englishProfile: "INDEPENDENT_LEVEL_UNUSED", filipinoProfile: "FRUSTRATION_HIGH_EMERGENT" },
      ],
      gradeType: "G11",
    });

    // Only the second record's filipinoProfile ("FRUSTRATION_HIGH_EMERGENT",
    // labelled "Frustration Level" on the SHS scale) is on G11's scale; the
    // first record's values and the fabricated "INDEPENDENT_LEVEL_UNUSED"
    // value are ignored.
    expect(stats.averageLabel).toBe("Frustration Level");
  });

  it("uses Kindergarten's 4-value early letter/word rubric, not the standard four", () => {
    // EARLY_RUBRIC_VALUES (src/lib/reading/policy.ts), low to high:
    // CANNOT_NAME_SOUND_LETTERS(0), LETTER_LEVEL(1), CV_BLENDING(2), CVC_BLENDING(3).
    // One learner at index 1, one at index 3: mean = (1 + 3) / 2 = 2 -> CV_BLENDING.
    // If the wrong scale (STANDARD_VALUES) were used, none of these keys would
    // match its ranks and averageLabel would come back null; if the rubric
    // were mis-ordered, the mean would round to a different label.
    const stats = computeReadingLevelStats({
      total: 2,
      completed: 2,
      records: [
        { englishProfile: "LETTER_LEVEL", filipinoProfile: "LETTER_LEVEL" },
        { englishProfile: "CVC_BLENDING", filipinoProfile: "CVC_BLENDING" },
      ],
      gradeType: "KINDER",
    });

    expect(stats.averageLabel).toBe("Level 2 - CV blending");
  });
});
