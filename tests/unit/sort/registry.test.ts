import { describe, expect, it } from "vitest";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";

const SORT = defineSort(
  [
    { value: "name", label: "Name" },
    { value: "age", label: "Age" },
    { value: "date-enrolled", label: "Date enrolled" },
  ] as const,
  "name"
);

describe("defineSort().parse", () => {
  it("accepts each allow-listed value", () => {
    expect(SORT.parse("name")).toBe("name");
    expect(SORT.parse("age")).toBe("age");
    expect(SORT.parse("date-enrolled")).toBe("date-enrolled");
  });

  it("is case-insensitive", () => {
    expect(SORT.parse("AGE")).toBe("age");
    expect(SORT.parse("Date-Enrolled")).toBe("date-enrolled");
  });

  it("falls back for an unknown value", () => {
    expect(SORT.parse("unknown")).toBe("name");
  });

  it("falls back for undefined", () => {
    expect(SORT.parse(undefined)).toBe("name");
  });

  it("falls back for an empty string", () => {
    expect(SORT.parse("")).toBe("name");
  });

  it("takes the first entry of an array and falls back for an empty array", () => {
    expect(SORT.parse(["age", "name"])).toBe("age");
    expect(SORT.parse([])).toBe("name");
  });

  it("returns the declared fallback, not the first option, when they differ", () => {
    const ageDefault = defineSort(
      [
        { value: "name", label: "Name" },
        { value: "age", label: "Age" },
      ] as const,
      "age"
    );
    expect(ageDefault.parse("unknown")).toBe("age");
    expect(ageDefault.parse(undefined)).toBe("age");
  });
});

describe("assertOrderByCoversOptions", () => {
  it("passes when every option has a matching orderBy clause", () => {
    expect(() =>
      assertOrderByCoversOptions(SORT, {
        name: { fullName: "asc" },
        age: { birthDate: "desc" },
        "date-enrolled": { createdAt: "desc" },
      })
    ).not.toThrow();
  });

  it("throws when an option has no matching orderBy clause", () => {
    expect(() =>
      assertOrderByCoversOptions(SORT, {
        name: { fullName: "asc" },
        age: { birthDate: "desc" },
      } as Record<(typeof SORT.options)[number]["value"], unknown>)
    ).toThrow(/date-enrolled/);
  });
});
