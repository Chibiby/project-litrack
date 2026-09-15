import { describe, it, expect } from "vitest";
import { shortGradeLabel } from "@/components/dashboard/simple-charts";

describe("shortGradeLabel", () => {
  it.each([
    ["Kinder", "K"],
    ["Grade 1", "G1"],
    ["Grade 11", "G11"],
    ["Floating", "Floating"],
  ])("%s → %s", (input, expected) => {
    expect(shortGradeLabel(input)).toBe(expected);
  });
});
