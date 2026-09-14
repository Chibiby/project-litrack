import { describe, expect, it } from "vitest";
import { bandWithLegacyValue } from "@/components/forms/aral-monthly-reading-level-grid-form";
import { readingProfileOptionsForGrade } from "@/lib/reading/policy";

const band = readingProfileOptionsForGrade("G1").map((o) => ({
  ...o,
  code: o.value,
  tone: "",
}));

describe("bandWithLegacyValue", () => {
  it("appends a Grade 1 value saved under the old letter/word rubric so the cell still shows it", () => {
    const options = bandWithLegacyValue(band, "CV_BLENDING", "G1");
    expect(options).toHaveLength(band.length + 1);
    expect(options.at(-1)?.value).toBe("CV_BLENDING");
    expect(options.at(-1)?.label).toMatch(/CV/i);
  });

  it("leaves the options alone for an in-policy or empty value", () => {
    expect(bandWithLegacyValue(band, "INDEPENDENT_GRADE_READY", "G1")).toBe(band);
    expect(bandWithLegacyValue(band, "", "G1")).toBe(band);
  });
});
