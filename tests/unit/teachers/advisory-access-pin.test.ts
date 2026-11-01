import { describe, expect, it } from "vitest";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import {
  ARAL_VOLUNTEER_DESIGNATION,
  ARAL_VOLUNTEER_LABEL,
  designationLabel,
} from "@/lib/validators/profile.schema";

/**
 * Pins "keep today's access" after the ARAL-teacher rename: the
 * stored designation string is unchanged (it is data in TeacherProfile and in the
 * backfill migration), only the label shown on screens changed.
 */
describe("the stored volunteer designation is unchanged", () => {
  it("is still the literal 'Non-DepEd ARAL Volunteer'", () => {
    expect(ARAL_VOLUNTEER_DESIGNATION).toBe("Non-DepEd ARAL Volunteer");
  });

  it("the display label is 'Non-DepEd ARAL Teacher' and differs from the stored value", () => {
    expect(ARAL_VOLUNTEER_LABEL).toBe("Non-DepEd ARAL Teacher");
    expect(ARAL_VOLUNTEER_LABEL).not.toBe(ARAL_VOLUNTEER_DESIGNATION);
  });
});

describe("designationLabel", () => {
  it("shows the stored volunteer value as 'Non-DepEd ARAL Teacher'", () => {
    expect(designationLabel("Non-DepEd ARAL Volunteer")).toBe("Non-DepEd ARAL Teacher");
    expect(designationLabel(ARAL_VOLUNTEER_DESIGNATION)).toBe("Non-DepEd ARAL Teacher");
  });

  it("passes every other value through unchanged", () => {
    expect(designationLabel("Teacher")).toBe("Teacher");
    expect(designationLabel("Master Teacher I")).toBe("Master Teacher I");
    expect(designationLabel("Non-DepEd ARAL Teacher")).toBe("Non-DepEd ARAL Teacher");
  });

  it("passes null and undefined through as null", () => {
    expect(designationLabel(null)).toBeNull();
    expect(designationLabel(undefined)).toBeNull();
  });
});

describe("advisoryRosterDenial keeps today's access", () => {
  const stored = "Non-DepEd ARAL Volunteer";

  it("denies the stored volunteer designation as 'volunteer', whatever the advisory mode", () => {
    for (const advisoryMode of ["DEFAULT", "MULTI_GRADE", "FLOATING"] as const) {
      expect(advisoryRosterDenial({ isSuperAdmin: false, designation: stored, advisoryMode })).toBe("volunteer");
    }
  });

  it("does not deny on the new display label: only the stored value is the volunteer", () => {
    expect(
      advisoryRosterDenial({ isSuperAdmin: false, designation: "Non-DepEd ARAL Teacher", advisoryMode: "DEFAULT" })
    ).toBeNull();
  });

  it("denies a FLOATING DepEd teacher as 'floating'", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "FLOATING" })).toBe("floating");
  });

  it("lets DEFAULT and MULTI_GRADE DepEd teachers through", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "DEFAULT" })).toBeNull();
    expect(advisoryRosterDenial({ isSuperAdmin: false, designation: "Teacher", advisoryMode: "MULTI_GRADE" })).toBeNull();
  });

  it("never denies a Super Admin, volunteer designation or FLOATING alike", () => {
    expect(advisoryRosterDenial({ isSuperAdmin: true, designation: stored, advisoryMode: "DEFAULT" })).toBeNull();
    expect(advisoryRosterDenial({ isSuperAdmin: true, designation: "Teacher", advisoryMode: "FLOATING" })).toBeNull();
  });
});
