import { describe, it, expect } from "vitest";
import { schoolIdCodeSchema, schoolRosterRowSchema } from "@/lib/validators/school-import.schema";

describe("schoolIdCodeSchema", () => {
  it("accepts a 6-digit DepEd id", () => {
    expect(schoolIdCodeSchema.safeParse("500282").success).toBe(true);
  });

  it("preserves leading zeros", () => {
    expect(schoolIdCodeSchema.parse("012345")).toBe("012345");
  });

  it("rejects fewer than 6 characters, because Supabase requires a 6-char password", () => {
    const res = schoolIdCodeSchema.safeParse("0");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toBe("School ID must be at least 6 characters");
    }
  });

  it("rejects characters outside [A-Za-z0-9_-]", () => {
    expect(schoolIdCodeSchema.safeParse("No School ID yet").success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(schoolIdCodeSchema.parse("  500282  ")).toBe("500282");
  });
});

describe("schoolRosterRowSchema", () => {
  it("accepts a full row", () => {
    const res = schoolRosterRowSchema.safeParse({
      schoolIdCode: "500282",
      name: "Alabel Integrated SPED Center",
      district: "Alabel 1",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty school name", () => {
    expect(schoolRosterRowSchema.safeParse({ schoolIdCode: "500282", name: "" }).success).toBe(false);
  });

  it("treats a blank district as undefined rather than an empty string", () => {
    const res = schoolRosterRowSchema.parse({ schoolIdCode: "500282", name: "X ES", district: "   " });
    expect(res.district).toBeUndefined();
  });
});
