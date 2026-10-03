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

describe("school year date keys", () => {
  it.each([
    ["an impossible calendar day", { startDate: "2026-02-30" }],
    ["a non-leap Feb 29", { startDate: "2026-02-29" }],
    ["month 13", { endDate: "2027-13-01" }],
    ["a free-form date string", { startDate: "June 2, 2025" }],
    ["a datetime string", { startDate: "2025-06-02T00:00:00+08:00" }],
    ["an unpadded date", { startDate: "2025-6-2" }],
  ])("rejects %s on both create and update", (_name, patch) => {
    expect(createSchoolYearSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
    expect(
      updateSchoolYearSchema.safeParse({ schoolYearId: "y1", ...VALID, ...patch }).success
    ).toBe(false);
  });

  it("accepts a real leap day", () => {
    const res = createSchoolYearSchema.safeParse({
      label: "2027-2028",
      startDate: "2028-02-29",
      endDate: "2028-03-31",
    });
    expect(res.success).toBe(true);
  });

  it("keeps a date as its calendar-day key, which stores as that UTC day", () => {
    const res = createSchoolYearSchema.safeParse({
      label: "2026-2027",
      startDate: "2026-06-01",
      endDate: "2027-03-31",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.startDate).toBe("2026-06-01");
      expect(new Date(res.data.startDate).toISOString().slice(0, 10)).toBe("2026-06-01");
    }
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
