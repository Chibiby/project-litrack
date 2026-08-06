import { describe, expect, it } from "vitest";
import {
  createSchoolYearSchema,
  setActiveSchoolYearSchema,
} from "@/lib/validators/school-year.schema";
import {
  createSectionSchema,
  updateSectionSchema,
  sectionIdSchema,
} from "@/lib/validators/section.schema";
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "@/lib/validators/announcement.schema";
import {
  updateSchoolInfoSchema,
  setSchoolActiveSchema,
  adminProfileSchema,
} from "@/lib/validators/school.schema";

describe("createSchoolYearSchema", () => {
  it("accepts consecutive YYYY-YYYY labels with ordered dates", () => {
    const ok = createSchoolYearSchema.safeParse({
      label: "2025-2026",
      startDate: "2025-06-01",
      endDate: "2026-05-31",
      setActive: "true",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.setActive).toBe(true);
  });

  it("rejects non-consecutive years and end before start", () => {
    expect(
      createSchoolYearSchema.safeParse({
        label: "2025-2027",
        startDate: "2025-06-01",
        endDate: "2026-05-31",
      }).success
    ).toBe(false);

    expect(
      createSchoolYearSchema.safeParse({
        label: "2025-2026",
        startDate: "2026-06-01",
        endDate: "2025-05-31",
      }).success
    ).toBe(false);
  });
});

describe("setActiveSchoolYearSchema", () => {
  it("requires schoolYearId", () => {
    expect(setActiveSchoolYearSchema.safeParse({ schoolYearId: "y1" }).success).toBe(true);
    expect(setActiveSchoolYearSchema.safeParse({ schoolYearId: "" }).success).toBe(false);
  });
});

describe("section schemas", () => {
  it("validates create/update/id", () => {
    expect(
      createSectionSchema.safeParse({ gradeLevelId: "g1", name: "Mabini" }).success
    ).toBe(true);
    expect(createSectionSchema.safeParse({ gradeLevelId: "g1", name: "" }).success).toBe(false);
    expect(
      updateSectionSchema.safeParse({ sectionId: "s1", name: "Rizal" }).success
    ).toBe(true);
    expect(sectionIdSchema.safeParse({ sectionId: "s1" }).success).toBe(true);
  });
});

describe("announcement schemas", () => {
  it("requires title and body", () => {
    expect(
      createAnnouncementSchema.safeParse({ title: "Hello", body: "World" }).success
    ).toBe(true);
    expect(createAnnouncementSchema.safeParse({ title: "", body: "x" }).success).toBe(false);
    expect(
      updateAnnouncementSchema.safeParse({
        announcementId: "a1",
        title: "T",
        body: "B",
      }).success
    ).toBe(true);
  });
});

describe("school info / admin schemas", () => {
  it("updateSchoolInfoSchema omits schoolIdCode", () => {
    const ok = updateSchoolInfoSchema.safeParse({
      name: "Sample School",
      region: "NCR",
      address: "",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.address).toBeUndefined();
      expect(ok.data.region).toBe("NCR");
    }
  });

  it("setSchoolActiveSchema coerces string booleans", () => {
    const on = setSchoolActiveSchema.safeParse({ schoolId: "s1", isActive: "true" });
    expect(on.success).toBe(true);
    if (on.success) expect(on.data.isActive).toBe(true);

    const off = setSchoolActiveSchema.safeParse({ schoolId: "s1", isActive: "false" });
    expect(off.success).toBe(true);
    if (off.success) expect(off.data.isActive).toBe(false);
  });

  it("adminProfileSchema requires names", () => {
    expect(
      adminProfileSchema.safeParse({
        firstName: "Ada",
        lastName: "Admin",
      }).success
    ).toBe(true);
    expect(adminProfileSchema.safeParse({ firstName: "", lastName: "X" }).success).toBe(false);
  });
});
