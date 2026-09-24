import { describe, expect, it } from "vitest";
import { bucketDesignation, bucketYearsInService } from "@/lib/summary/shape/profiling-buckets";

describe("bucketYearsInService (T16)", () => {
  it.each([
    [0, "Y0_3"],
    [3, "Y0_3"],
    [4, "Y4_10"],
    [10, "Y4_10"],
    [11, "Y11_20"],
    [20, "Y11_20"],
    [21, "Y21_PLUS"],
    [70, "Y21_PLUS"],
  ])("%i years is %s", (years, bucket) => {
    expect(bucketYearsInService(years)).toBe(bucket);
  });

  it("null (a teacher who chose N/A) is NA", () => {
    expect(bucketYearsInService(null)).toBe("NA");
    expect(bucketYearsInService(undefined)).toBe("NA");
  });
});

describe("bucketDesignation", () => {
  it("sorts the offered designations", () => {
    expect(bucketDesignation("Teacher")).toBe("TEACHER");
    expect(bucketDesignation("Master Teacher")).toBe("MASTER_TEACHER");
    expect(bucketDesignation("School Head")).toBe("SCHOOL_HEAD");
    expect(bucketDesignation("Non-DepEd ARAL Volunteer")).toBe("ARAL_VOLUNTEER");
  });

  it("matches regardless of case and spacing", () => {
    expect(bucketDesignation("  master   teacher ")).toBe("MASTER_TEACHER");
  });

  it("puts any other text in Others and a blank in Not answered", () => {
    expect(bucketDesignation("Guidance Coordinator")).toBe("OTHERS");
    expect(bucketDesignation("")).toBe("NOT_ANSWERED");
    expect(bucketDesignation(null)).toBe("NOT_ANSWERED");
  });
});
