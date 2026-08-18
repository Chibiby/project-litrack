import { describe, it, expect } from "vitest";
import {
  ALL_DISTRICTS,
  deriveDistricts,
  schoolsInDistrict,
  clearStaleSchool,
  type SchoolOption,
} from "@/lib/login/district-filter";

const school = (id: string, name: string, district: string | null): SchoolOption => ({
  id,
  name,
  district,
  teachersOpen: false,
});

const SCHOOLS = [
  school("1", "Alabel Central ES", "Alabel 1"),
  school("2", "Banlibato IS", "Alabel 1"),
  school("3", "Glan Central ES", "Glan 2"),
  school("4", "Orphan ES", null),
  school("5", "Blankish ES", "   "),
];

describe("deriveDistricts", () => {
  it("returns distinct non-empty districts, sorted", () => {
    expect(deriveDistricts(SCHOOLS)).toEqual(["Alabel 1", "Glan 2"]);
  });

  it("ignores null and whitespace-only districts", () => {
    expect(deriveDistricts([school("1", "A", null), school("2", "B", "  ")])).toEqual([]);
  });

  it("returns an empty list for no schools", () => {
    expect(deriveDistricts([])).toEqual([]);
  });
});

describe("schoolsInDistrict", () => {
  it("returns every school under the all-districts sentinel", () => {
    expect(schoolsInDistrict(SCHOOLS, ALL_DISTRICTS)).toHaveLength(5);
  });

  it("narrows to one district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Alabel 1").map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("excludes district-less schools from a specific district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Glan 2").map((s) => s.id)).toEqual(["3"]);
  });

  it("returns nothing for an unknown district", () => {
    expect(schoolsInDistrict(SCHOOLS, "Nowhere 9")).toEqual([]);
  });
});

describe("clearStaleSchool", () => {
  it("keeps a selection that is still visible", () => {
    expect(clearStaleSchool("1", schoolsInDistrict(SCHOOLS, "Alabel 1"))).toBe("1");
  });

  it("clears a selection the new district hides", () => {
    expect(clearStaleSchool("3", schoolsInDistrict(SCHOOLS, "Alabel 1"))).toBe("");
  });

  it("is a no-op when nothing is selected", () => {
    expect(clearStaleSchool("", SCHOOLS)).toBe("");
  });
});
