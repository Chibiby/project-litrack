import { describe, expect, it } from "vitest";
import {
  createDivisionSchoolYearSchema,
  deleteSchoolYearSchema,
  setActiveSchoolYearSchema,
  setSchoolYearMonthsSchema,
} from "@/lib/validators/school-year.schema";

describe("createDivisionSchoolYearSchema", () => {
  const base = { label: "2027-2028", startMonth: "2027-06", endMonth: "2028-04" };

  it("accepts a consecutive label with ordered months", () => {
    const res = createDivisionSchoolYearSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.endMonth).toBe("2028-04");
      expect(res.data.setActive).toBe(false);
    }
  });

  it("treats a blank end month as not set", () => {
    const res = createDivisionSchoolYearSchema.safeParse({ ...base, endMonth: "  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.endMonth).toBeNull();
  });

  it("reads the checkbox value", () => {
    const res = createDivisionSchoolYearSchema.safeParse({ ...base, setActive: "on" });
    expect(res.success && res.data.setActive).toBe(true);
  });

  it("rejects a bad label, a bad month, and an end month not after the start", () => {
    expect(createDivisionSchoolYearSchema.safeParse({ ...base, label: "2027" }).success).toBe(false);
    expect(createDivisionSchoolYearSchema.safeParse({ ...base, label: "2027-2029" }).success).toBe(false);
    expect(createDivisionSchoolYearSchema.safeParse({ ...base, startMonth: "2027-13" }).success).toBe(false);
    expect(createDivisionSchoolYearSchema.safeParse({ ...base, endMonth: "2027-06" }).success).toBe(false);
    expect(createDivisionSchoolYearSchema.safeParse({ ...base, endMonth: "2026-12" }).success).toBe(false);
  });
});

describe("setSchoolYearMonthsSchema", () => {
  it("needs a year and a start month; the end month is optional", () => {
    expect(
      setSchoolYearMonthsSchema.safeParse({ schoolYearId: "y1", startMonth: "2026-06" }).success
    ).toBe(true);
    expect(setSchoolYearMonthsSchema.safeParse({ schoolYearId: "y1", startMonth: "" }).success).toBe(
      false
    );
    expect(setSchoolYearMonthsSchema.safeParse({ startMonth: "2026-06" }).success).toBe(false);
  });

  it("names the end month field when it comes before the start", () => {
    const res = setSchoolYearMonthsSchema.safeParse({
      schoolYearId: "y1",
      startMonth: "2026-06",
      endMonth: "2026-01",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["endMonth"]);
  });
});

describe("id-only schemas", () => {
  it("require a school year id", () => {
    expect(setActiveSchoolYearSchema.safeParse({ schoolYearId: "y1" }).success).toBe(true);
    expect(deleteSchoolYearSchema.safeParse({ schoolYearId: "" }).success).toBe(false);
  });
});
