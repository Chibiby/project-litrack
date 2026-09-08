import { describe, it, expect } from "vitest";
import {
  formatPersonName,
  formatOptionalPersonName,
  formatOptionalLabel,
  collapseWhitespace,
  buildFullName,
} from "@/lib/names";

describe("formatPersonName", () => {
  it("title-cases plain names and collapses whitespace", () => {
    expect(formatPersonName("  ANA   marie ")).toBe("Ana Marie");
    expect(formatPersonName("juan")).toBe("Juan");
    expect(formatPersonName("Juan   Carlos")).toBe("Juan Carlos");
  });

  it("capitalises Filipino surname particles in full", () => {
    expect(formatPersonName("juan dela cruz")).toBe("Juan Dela Cruz");
    expect(formatPersonName("MARIA DELOS SANTOS")).toBe("Maria Delos Santos");
    expect(formatPersonName("de guzman")).toBe("De Guzman");
  });

  it("capitalises across hyphens and apostrophes", () => {
    expect(formatPersonName("MARY-JANE")).toBe("Mary-Jane");
    expect(formatPersonName("o'brien")).toBe("O'Brien");
    expect(formatPersonName("D'SOUZA")).toBe("D'Souza");
    expect(formatPersonName("ma’am-test")).toBe("Ma’Am-Test");
  });

  it("upper-cases roman-numeral suffixes but not leading given names", () => {
    expect(formatPersonName("jose rizal iii")).toBe("Jose Rizal III");
    expect(formatPersonName("santos iv")).toBe("Santos IV");
    expect(formatPersonName("cruz III.")).toBe("Cruz III.");
    // A lone token is a given name, never a suffix.
    expect(formatPersonName("vi")).toBe("Vi");
    expect(formatPersonName("di")).toBe("Di");
  });

  it("title-cases Jr./Sr. rather than upper-casing them", () => {
    expect(formatPersonName("juan santos jr.")).toBe("Juan Santos Jr.");
    expect(formatPersonName("JUAN SANTOS SR")).toBe("Juan Santos Sr");
  });

  it("handles Mc but leaves Mac alone", () => {
    expect(formatPersonName("MCDONALD")).toBe("McDonald");
    expect(formatPersonName("macario")).toBe("Macario");
  });

  it("preserves a middle initial", () => {
    expect(formatPersonName("d.")).toBe("D.");
  });

  it("returns empty string for blank input", () => {
    expect(formatPersonName("   ")).toBe("");
    expect(formatPersonName("")).toBe("");
  });

  it("is idempotent", () => {
    const once = formatPersonName("juan dela cruz iii");
    expect(formatPersonName(once)).toBe(once);
  });
});

describe("formatOptionalPersonName", () => {
  it("maps null/undefined/blank to undefined", () => {
    expect(formatOptionalPersonName(null)).toBeUndefined();
    expect(formatOptionalPersonName(undefined)).toBeUndefined();
    expect(formatOptionalPersonName("   ")).toBeUndefined();
  });

  it("formats a present value", () => {
    expect(formatOptionalPersonName(" santos ")).toBe("Santos");
  });
});

describe("formatOptionalLabel", () => {
  it("collapses whitespace but never changes case", () => {
    expect(formatOptionalLabel("  Region   XI ")).toBe("Region XI");
    expect(formatOptionalLabel("Sample Central ES")).toBe("Sample Central ES");
    expect(formatOptionalLabel("DAVAO DEL SUR")).toBe("DAVAO DEL SUR");
  });

  it("maps blank to undefined", () => {
    expect(formatOptionalLabel("  ")).toBeUndefined();
    expect(formatOptionalLabel(null)).toBeUndefined();
  });
});

describe("collapseWhitespace", () => {
  it("trims and collapses runs", () => {
    expect(collapseWhitespace("  a   b  ")).toBe("a b");
  });
});

describe("buildFullName", () => {
  it("skips an absent middle name", () => {
    expect(buildFullName("Juan", null, "Cruz")).toBe("Juan Cruz");
    expect(buildFullName("Juan", "Dela", "Cruz")).toBe("Juan Dela Cruz");
    expect(buildFullName("Juan", undefined, "Cruz")).toBe("Juan Cruz");
  });
});
