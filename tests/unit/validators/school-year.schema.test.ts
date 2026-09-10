import { describe, expect, it } from "vitest";
import {
  createSchoolYearSchema,
  deleteSchoolYearSchema,
  setActiveSchoolYearSchema,
  updateSchoolYearSchema,
} from "@/lib/validators/school-year.schema";

const VALID = {
  label: "2025-2026",
  startDate: "2025-06-02",
  endDate: "2026-03-31",
};

describe("createSchoolYearSchema", () => {
  it("accepts a well-formed year", () => {
    const res = createSchoolYearSchema.safeParse(VALID);
    expect(res.success).toBe(true);
  });

  it("coerces the setActive checkbox from its form values", () => {
    for (const [input, expected] of [
      ["true", true],
      ["on", true],
      ["false", false],
      ["off", false],
      [undefined, false],
    ] as const) {
      const res = createSchoolYearSchema.safeParse({ ...VALID, setActive: input });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.setActive).toBe(expected);
    }
  });
});

describe("updateSchoolYearSchema", () => {
  it("accepts a correction with an id", () => {
    const res = updateSchoolYearSchema.safeParse({
      schoolYearId: "year-1",
      ...VALID,
    });
    expect(res.success).toBe(true);
  });

  it("requires the school year id", () => {
    const res = updateSchoolYearSchema.safeParse({ schoolYearId: "", ...VALID });
    expect(res.success).toBe(false);
  });

  it("has no setActive field, so an edit cannot change the active year", () => {
    const res = updateSchoolYearSchema.safeParse({
      schoolYearId: "year-1",
      ...VALID,
      setActive: "true",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).not.toHaveProperty("setActive");
    }
  });

  // The point of extracting the shared refinement: an edit must be held to the
  // same rules as a create, or a correction can save what a create would reject.
  it.each([
    ["a non-consecutive label", { label: "2025-2027" }],
    ["a malformed label", { label: "2025/2026" }],
    ["an end date before the start", { startDate: "2026-03-31", endDate: "2025-06-02" }],
    ["an end date equal to the start", { startDate: "2025-06-02", endDate: "2025-06-02" }],
    ["a missing start date", { startDate: "" }],
    ["a missing end date", { endDate: "" }],
  ])("rejects %s on both create and update", (_name, patch) => {
    const create = createSchoolYearSchema.safeParse({ ...VALID, ...patch });
    const update = updateSchoolYearSchema.safeParse({
      schoolYearId: "year-1",
      ...VALID,
      ...patch,
    });
    expect(create.success).toBe(false);
    expect(update.success).toBe(false);
  });

  it("trims a padded label", () => {
    const res = updateSchoolYearSchema.safeParse({
      schoolYearId: "year-1",
      ...VALID,
      label: "  2025-2026  ",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.label).toBe("2025-2026");
  });
});

describe("setActiveSchoolYearSchema / deleteSchoolYearSchema", () => {
  it("both require a school year id", () => {
    expect(setActiveSchoolYearSchema.safeParse({ schoolYearId: "y1" }).success).toBe(true);
    expect(setActiveSchoolYearSchema.safeParse({ schoolYearId: "" }).success).toBe(false);
    expect(deleteSchoolYearSchema.safeParse({ schoolYearId: "y1" }).success).toBe(true);
    expect(deleteSchoolYearSchema.safeParse({ schoolYearId: "" }).success).toBe(false);
  });
});
