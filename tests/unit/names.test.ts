import { describe, it, expect } from "vitest";
import {
  formatPersonName,
  formatOptionalPersonName,
  formatOptionalLabel,
  collapseWhitespace,
  buildFullName,
  formatListingName,
  formatListingNameFromRecord,
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

  // Regression guard: the DepEd surname-first display formatter must never
  // change what gets written to the stored `fullName` column.
  it("keeps producing today's Firstname Middlename Lastname shape, unaffected by the listing formatter", () => {
    expect(buildFullName("Juan", "Dela", "Cruz")).toBe("Juan Dela Cruz");
    expect(buildFullName("Maria", null, "Santos")).toBe("Maria Santos");
    expect(buildFullName("Maria", undefined, "Santos")).toBe("Maria Santos");
    expect(buildFullName("Maria", "", "Santos")).toBe("Maria Santos");
    expect(buildFullName("Jose", "Protacio", "Rizal")).toBe("Jose Protacio Rizal");
  });
});

describe("formatListingName", () => {
  it('renders "Lastname, Firstname Middlename" for a full triple', () => {
    expect(formatListingName("Juan", "Miguel", "Dela Cruz")).toBe(
      "Dela Cruz, Juan Miguel"
    );
  });

  it("collapses a whitespace-only middle name with no trailing space", () => {
    expect(formatListingName("Juan", "   ", "Dela Cruz")).toBe("Dela Cruz, Juan");
  });

  it("collapses a null middle name with no stray comma", () => {
    expect(formatListingName("Juan", null, "Dela Cruz")).toBe("Dela Cruz, Juan");
  });

  it("collapses an undefined middle name", () => {
    expect(formatListingName("Juan", undefined, "Dela Cruz")).toBe(
      "Dela Cruz, Juan"
    );
  });

  it("falls back to the given name with no leading comma when lastName is blank", () => {
    expect(formatListingName("Juan", "Miguel", "")).toBe("Juan Miguel");
    expect(formatListingName("Juan", null, "   ")).toBe("Juan");
  });

  it("is a pure display transform: it never mutates buildFullName's stored shape", () => {
    const stored = buildFullName("Juan", "Miguel", "Dela Cruz");
    expect(stored).toBe("Juan Miguel Dela Cruz");
    expect(formatListingName("Juan", "Miguel", "Dela Cruz")).toBe(
      "Dela Cruz, Juan Miguel"
    );
  });
});

describe("formatListingNameFromRecord", () => {
  it("matches formatListingName for the same parts, spread from a row object", () => {
    const record = { firstName: "Juan", middleName: "Miguel", lastName: "Dela Cruz" };
    expect(formatListingNameFromRecord(record)).toBe(
      formatListingName(record.firstName, record.middleName, record.lastName)
    );
  });

  it("handles an omitted middleName field", () => {
    expect(
      formatListingNameFromRecord({ firstName: "Juan", lastName: "Cruz" })
    ).toBe("Cruz, Juan");
  });
});
