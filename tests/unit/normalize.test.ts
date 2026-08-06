import { describe, expect, it } from "vitest";
import {
  isPossibleDuplicate,
  learnerDuplicateKey,
  normalizePersonName,
} from "@/lib/learners/normalize";

describe("normalizePersonName", () => {
  it("trims, lowercases, and collapses spaces", () => {
    expect(normalizePersonName("  Ana   MARIE ")).toBe("ana marie");
  });
});

describe("duplicate keys", () => {
  it("matches name+age after normalize", () => {
    expect(learnerDuplicateKey("Ana", "Santos", 10)).toBe(
      learnerDuplicateKey(" ana ", "SANTOS", 10)
    );
    expect(
      isPossibleDuplicate(
        { firstName: "Ana", lastName: "Santos", age: 10 },
        { firstName: "ANA", lastName: "santos", age: 10 }
      )
    ).toBe(true);
    expect(
      isPossibleDuplicate(
        { firstName: "Ana", lastName: "Santos", age: 10 },
        { firstName: "Ana", lastName: "Santos", age: 11 }
      )
    ).toBe(false);
  });
});
