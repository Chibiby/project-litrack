import { describe, expect, it } from "vitest";
import { schoolHeadSyntheticEmail, teacherSyntheticEmail } from "./synthetic-email";

describe("schoolHeadSyntheticEmail", () => {
  it("normalizes school id code into a synthetic address", () => {
    expect(schoolHeadSyntheticEmail("Demo_123")).toBe("sh@demo-123.litrack.local");
    expect(schoolHeadSyntheticEmail("demo 456")).toBe("sh@demo-456.litrack.local");
  });
});

describe("teacherSyntheticEmail", () => {
  it("builds username@school.local", () => {
    expect(teacherSyntheticEmail("teacher.cruz.ab12")).toBe("teacher.cruz.ab12@school.local");
    expect(teacherSyntheticEmail("  Mixed.Case  ")).toBe("mixed.case@school.local");
  });
});
