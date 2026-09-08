import { describe, it, expect } from "vitest";
import { optionalPhPhone, canonicalPhPhone } from "@/lib/validators/phone";
import { email } from "@/lib/validators/common";
import { createSchoolSchema, updateSchoolInfoSchema } from "@/lib/validators/school.schema";
import { schoolRosterRowSchema } from "@/lib/validators/school-import.schema";

describe("optionalPhPhone canonicalisation", () => {
  it("folds every spelling of one mobile number to a single stored value", () => {
    const forms = ["0917 123 4567", "0917-123-4567", "+639171234567", "639171234567", "09171234567"];
    const parsed = forms.map((f) => optionalPhPhone.parse(f));
    expect(new Set(parsed).size).toBe(1);
    expect(parsed[0]).toBe("09171234567");
  });

  it("keeps landlines in local form, separators stripped", () => {
    expect(optionalPhPhone.parse("(082) 234-5678")).toBe("0822345678");
  });

  it("still rejects an invalid number", () => {
    expect(optionalPhPhone.safeParse("12345").success).toBe(false);
  });

  it("passes blank through as undefined", () => {
    expect(optionalPhPhone.parse("")).toBeUndefined();
  });

  it("is idempotent", () => {
    expect(canonicalPhPhone(canonicalPhPhone("+63 917 123 4567"))).toBe("09171234567");
  });
});

describe("email primitive", () => {
  it("lower-cases so a case variant cannot become a second account", () => {
    expect(email.parse("  Teacher@Example.COM ")).toBe("teacher@example.com");
  });
});

describe("school label fields", () => {
  const base = { name: "Sample Central ES", schoolIdCode: "123456" };

  it("collapses internal whitespace without changing case", () => {
    const parsed = createSchoolSchema.parse({
      ...base,
      region: "  Region   XI ",
      division: "DAVAO DEL SUR",
    });
    expect(parsed.region).toBe("Region XI");
    expect(parsed.division).toBe("DAVAO DEL SUR");
  });

  it("rejects an over-long address instead of silently truncating it", () => {
    const result = createSchoolSchema.safeParse({ ...base, address: "x".repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toMatch(/500 characters or fewer/);
    }
  });

  it("rejects an over-long short field", () => {
    expect(createSchoolSchema.safeParse({ ...base, region: "x".repeat(101) }).success).toBe(false);
  });

  it("accepts a value exactly at the limit", () => {
    expect(createSchoolSchema.safeParse({ ...base, address: "x".repeat(500) }).success).toBe(true);
  });

  it("maps a blank optional to undefined", () => {
    expect(createSchoolSchema.parse({ ...base, district: "   " }).district).toBeUndefined();
  });

  it("applies the same rules on the School Head's edit form", () => {
    expect(updateSchoolInfoSchema.parse({ name: "A School", district: " Poblacion  West " }).district)
      .toBe("Poblacion West");
    expect(updateSchoolInfoSchema.safeParse({ name: "A School", address: "x".repeat(501) }).success)
      .toBe(false);
  });

  it("applies the same rules on the roster import row", () => {
    const parsed = schoolRosterRowSchema.parse({
      schoolIdCode: "123456",
      name: "Sample Central ES",
      region: "  Region   XI ",
    });
    expect(parsed.region).toBe("Region XI");
    expect(schoolRosterRowSchema.safeParse({
      schoolIdCode: "123456",
      name: "Sample Central ES",
      address: "x".repeat(501),
    }).success).toBe(false);
  });
});

describe("PH landline area codes", () => {
  it("accepts the Mindanao 08x block LITRACK's own schools use", () => {
    // 082 Davao, 083 General Santos, 088 Cagayan de Oro.
    expect(optionalPhPhone.parse("(082) 234-5678")).toBe("0822345678");
    expect(optionalPhPhone.safeParse("0832345678").success).toBe(true);
    expect(optionalPhPhone.safeParse("0882345678").success).toBe(true);
  });

  it("still rejects the unassigned 080 and 081 prefixes", () => {
    expect(optionalPhPhone.safeParse("08171234567").success).toBe(false);
    expect(optionalPhPhone.safeParse("0801234567").success).toBe(false);
  });

  it("still accepts the original 02–07 codes", () => {
    expect(optionalPhPhone.safeParse("0322345678").success).toBe(true);
    expect(optionalPhPhone.safeParse("021234567").success).toBe(true);
  });
});
