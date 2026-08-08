import { describe, expect, it } from "vitest";
import {
  countLetterSections,
  lettersNeededToReachCount,
  nextUnusedLetter,
} from "@/lib/section-letters";

describe("nextUnusedLetter", () => {
  it("returns A when none used", () => {
    expect(nextUnusedLetter([])).toBe("A");
    expect(nextUnusedLetter(["Rose", "Lily"])).toBe("A");
  });

  it("skips used letters case-insensitively", () => {
    expect(nextUnusedLetter(["A", "b"])).toBe("C");
  });

  it("returns null when A–Z are all used", () => {
    const all = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    expect(nextUnusedLetter(all)).toBeNull();
  });
});

describe("countLetterSections", () => {
  it("counts only single-letter A–Z names", () => {
    expect(countLetterSections(["A", "B", "Rose", "AA", ""])).toBe(2);
  });
});

describe("lettersNeededToReachCount", () => {
  it("returns first N free letters when none exist", () => {
    expect(lettersNeededToReachCount([], 3)).toEqual(["A", "B", "C"]);
  });

  it("only fills the gap to the target letter count", () => {
    expect(lettersNeededToReachCount(["A", "C"], 3)).toEqual(["B"]);
    expect(lettersNeededToReachCount(["A", "B"], 2)).toEqual([]);
  });

  it("counts custom-named sections toward the floor", () => {
    expect(lettersNeededToReachCount(["Rose", "Lily"], 2)).toEqual([]);
    expect(lettersNeededToReachCount(["Rose", "Lily"], 3)).toEqual(["A"]);
  });

  it("caps at 26", () => {
    expect(lettersNeededToReachCount([], 30)).toHaveLength(26);
  });
});
