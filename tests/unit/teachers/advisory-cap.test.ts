import { describe, expect, it } from "vitest";
import { advisoryCapFor, advisoryCapReason, MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

describe("advisoryCapFor", () => {
  it.each([
    ["Teacher", "DEFAULT", 1],
    ["Teacher", "FLOATING", 0],
    ["Teacher", "MULTI_GRADE", 3],
    ["Master Teacher", "MULTI_GRADE", 3],
    ["ARAL Coordinator", "DEFAULT", 1], // Others behaves like Teacher
    ["ARAL Coordinator", "MULTI_GRADE", 3],
  ] as const)("%s + %s → %i", (designation, mode, cap) => {
    expect(advisoryCapFor(designation, mode)).toBe(cap);
  });

  it("gives a volunteer zero whatever the mode says", () => {
    for (const mode of ["DEFAULT", "FLOATING", "MULTI_GRADE"] as const) {
      expect(advisoryCapFor(ARAL_VOLUNTEER_DESIGNATION, mode)).toBe(0);
    }
  });

  it("treats a missing mode as DEFAULT", () => {
    expect(advisoryCapFor("Teacher", null)).toBe(1);
    expect(advisoryCapFor("Teacher", undefined)).toBe(1);
  });

  it("keeps MAX_ADVISORY_SECTIONS as the multi-grade ceiling", () => {
    expect(MAX_ADVISORY_SECTIONS).toBe(3);
    expect(advisoryCapFor("Teacher", "MULTI_GRADE")).toBe(MAX_ADVISORY_SECTIONS);
  });

  it("explains each cap in words a School Head can act on", () => {
    expect(advisoryCapReason(ARAL_VOLUNTEER_DESIGNATION, "DEFAULT")).toMatch(/volunteer/i);
    expect(advisoryCapReason("Teacher", "FLOATING")).toMatch(/floating/i);
    expect(advisoryCapReason("Teacher", "DEFAULT")).toMatch(/one section/i);
    expect(advisoryCapReason("Teacher", "MULTI_GRADE")).toMatch(/3/);
  });
});
