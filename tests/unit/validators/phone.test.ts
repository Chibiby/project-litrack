import { describe, expect, it } from "vitest";
import { isValidPhPhone, normalizePhPhone, optionalPhPhone } from "@/lib/validators/phone";

describe("normalizePhPhone", () => {
  it("strips spaces dashes and parens", () => {
    expect(normalizePhPhone("0917 123 4567")).toBe("09171234567");
    expect(normalizePhPhone("+63 (917) 123-4567")).toBe("+639171234567");
  });
});

describe("isValidPhPhone", () => {
  it("accepts PH mobile formats", () => {
    expect(isValidPhPhone("09171234567")).toBe(true);
    expect(isValidPhPhone("+639171234567")).toBe(true);
    expect(isValidPhPhone("639171234567")).toBe(true);
  });

  it("accepts common landline lengths", () => {
    expect(isValidPhPhone("0281234567")).toBe(true);
    expect(isValidPhPhone("0321234567")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isValidPhPhone("123")).toBe(false);
    expect(isValidPhPhone("08171234567")).toBe(false);
    expect(isValidPhPhone("not-a-phone")).toBe(false);
  });
});

describe("optionalPhPhone", () => {
  it("allows empty", () => {
    expect(optionalPhPhone.safeParse("").success).toBe(true);
    expect(optionalPhPhone.safeParse(undefined).success).toBe(true);
  });

  it("rejects bad phone when provided", () => {
    expect(optionalPhPhone.safeParse("12345").success).toBe(false);
  });
});
