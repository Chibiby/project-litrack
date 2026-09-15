import { describe, expect, it } from "vitest";
import { parseLearnerListParams, stepAdvisory } from "@/lib/learners/pagination";

describe("stepAdvisory", () => {
  const ids = ["a", "b"];

  it("walks forward through all advisories and wraps back to all", () => {
    expect(stepAdvisory(ids, null, 1)).toBe("a");
    expect(stepAdvisory(ids, "a", 1)).toBe("b");
    expect(stepAdvisory(ids, "b", 1)).toBeNull();
  });

  it("walks backward and wraps to the last advisory", () => {
    expect(stepAdvisory(ids, null, -1)).toBe("b");
    expect(stepAdvisory(ids, "a", -1)).toBeNull();
  });

  it("treats an unknown current value as all advisories", () => {
    expect(stepAdvisory(ids, "zzz", 1)).toBe("a");
  });

  it("stays on all when the teacher advises nothing", () => {
    expect(stepAdvisory([], null, 1)).toBeNull();
  });
});

describe("parseLearnerListParams advisory", () => {
  it("reads a section id and treats empty or all as no filter", () => {
    expect(parseLearnerListParams({ advisory: "sec-1" }).advisory).toBe("sec-1");
    expect(parseLearnerListParams({ advisory: "all" }).advisory).toBeNull();
    expect(parseLearnerListParams({}).advisory).toBeNull();
  });
});
