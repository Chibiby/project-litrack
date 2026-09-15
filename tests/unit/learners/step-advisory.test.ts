import { describe, expect, it } from "vitest";
import { parseLearnerListParams } from "@/lib/learners/pagination";

describe("parseLearnerListParams advisory", () => {
  it("reads a section id and treats empty or all as no filter", () => {
    expect(parseLearnerListParams({ advisory: "sec-1" }).advisory).toBe("sec-1");
    expect(parseLearnerListParams({ advisory: "all" }).advisory).toBeNull();
    expect(parseLearnerListParams({}).advisory).toBeNull();
  });
});
