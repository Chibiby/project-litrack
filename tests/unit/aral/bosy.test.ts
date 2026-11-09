import { describe, expect, it } from "vitest";
import {
  BOSY_TIER_VALUES,
  bosyTierOf,
  bosyTierWhere,
  computeBosyStats,
  parseBosyTier,
} from "@/lib/aral/bosy";

describe("BOSY tiers", () => {
  it("puts every ReadingProfile value in exactly one tier", () => {
    const all = Object.values(BOSY_TIER_VALUES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(
      [
        "NON_DECODER_LOW_EMERGENT",
        "FRUSTRATION_HIGH_EMERGENT",
        "INSTRUCTIONAL_DEVELOPING",
        "DEVELOPING",
        "TRANSITIONING",
        "INDEPENDENT_GRADE_READY",
        "CANNOT_NAME_SOUND_LETTERS",
        "LETTER_LEVEL",
        "CV_BLENDING",
        "CVC_BLENDING",
      ].sort()
    );
  });

  it("folds the Kinder–Grade 2 rubric into the same tiers by rank", () => {
    expect(bosyTierOf("CANNOT_NAME_SOUND_LETTERS")).toBe("tier1");
    expect(bosyTierOf("NON_DECODER_LOW_EMERGENT")).toBe("tier1");
    expect(bosyTierOf("CVC_BLENDING")).toBe("tier4");
    expect(bosyTierOf("TRANSITIONING")).toBe("tier3");
    expect(bosyTierOf(null)).toBeNull();
    expect(bosyTierOf("BOGUS")).toBeNull();
  });

  it("parses unknown level params as all", () => {
    expect(parseBosyTier("tier2")).toBe("tier2");
    expect(parseBosyTier("x")).toBe("all");
    expect(parseBosyTier(undefined)).toBe("all");
  });

  it("filters on the Filipino level only", () => {
    expect(bosyTierWhere("all")).toEqual({});
    expect(bosyTierWhere("tier3")).toEqual({
      filipinoReadingProfile: {
        in: ["INSTRUCTIONAL_DEVELOPING", "DEVELOPING", "TRANSITIONING", "CV_BLENDING"],
      },
    });
  });

  it("builds five cards and clamps negatives", () => {
    const cards = computeBosyStats({ all: 14, tier1: 5, tier2: -1, tier3: 4, tier4: 2 });
    expect(cards.map((c) => [c.key, c.value])).toEqual([
      ["total", 14],
      ["tier1", 5],
      ["tier2", 0],
      ["tier3", 4],
      ["tier4", 2],
    ]);
  });
});
