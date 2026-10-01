import { describe, expect, it } from "vitest";
import { describeActiveFilters, type ListFilterField } from "@/components/admin/management/list-filter-bar";
import {
  districtField,
  gradeField,
  schoolField,
  scopeLabel,
  sectionField,
  yesNoField,
} from "@/components/admin/management/filter-fields";

const SCHOOLS = [
  { id: "s1", name: "Naidas T. Opong ES", schoolIdCode: "130554", district: "Alamada" },
  { id: "s2", name: "Banga CES", schoolIdCode: "130555", district: null },
];

describe("describeActiveFilters", () => {
  const district: ListFilterField = {
    key: "district",
    label: "District",
    allLabel: "All districts",
    value: "Alamada",
    options: [{ value: "Alamada", label: "Alamada" }],
  };
  const school: ListFilterField = {
    key: "schoolId",
    label: "School",
    allLabel: "All schools",
    value: "s1",
    options: [{ value: "s1", label: "Naidas T. Opong ES" }],
  };

  it("is empty when nothing narrows the list", () => {
    expect(describeActiveFilters([], "")).toEqual([]);
    expect(describeActiveFilters([{ ...district, value: "" }], "")).toEqual([]);
  });

  it("uses the option's label, not its raw value", () => {
    expect(describeActiveFilters([school], "")).toEqual(["School: Naidas T. Opong ES"]);
  });

  it("falls back to the raw value when the option is not in the list", () => {
    expect(describeActiveFilters([{ ...school, value: "gone-id" }], "")).toEqual(["School: gone-id"]);
  });

  it("lists filters in field order, then the search last, with curly quotes", () => {
    expect(describeActiveFilters([district, school], "ana")).toEqual([
      "District: Alamada",
      "School: Naidas T. Opong ES",
      "Search: “ana”",
    ]);
  });

  it("skips unset fields and still reports the search", () => {
    expect(describeActiveFilters([{ ...district, value: "" }, school], "x")).toEqual([
      "School: Naidas T. Opong ES",
      "Search: “x”",
    ]);
  });
});

describe("scopeLabel", () => {
  it("reads 'Whole division' when nothing narrows the figures", () => {
    expect(scopeLabel({})).toBe("Whole division");
    expect(scopeLabel({ extra: [] })).toBe("Whole division");
  });

  it("names the district", () => {
    expect(scopeLabel({ district: "Alamada" })).toBe("Alamada district");
  });

  it("names the school, and the school wins over the district", () => {
    expect(scopeLabel({ district: "Alamada", schoolId: "s1", schools: SCHOOLS })).toBe("Naidas T. Opong ES");
  });

  it("says 'One school' when the chosen school is not in the loaded options", () => {
    expect(scopeLabel({ schoolId: "unknown", schools: SCHOOLS })).toBe("One school");
    expect(scopeLabel({ schoolId: "s1" })).toBe("One school");
  });

  it("appends extras (grade, section) after the place, joined with a middle dot", () => {
    expect(scopeLabel({ schoolId: "s1", schools: SCHOOLS, extra: ["Grade 3", "Section Rizal"] })).toBe(
      "Naidas T. Opong ES · Grade 3 · Section Rizal"
    );
  });

  it("with only extras, does not claim 'Whole division'", () => {
    expect(scopeLabel({ extra: ["Grade 3"] })).toBe("Grade 3");
  });
});

describe("filter field builders", () => {
  it("districtField carries the cascade clears and a school-count hint", () => {
    const f = districtField(
      [
        { district: "Alamada", schools: 1 },
        { district: "Banga", schools: 12 },
      ],
      "Banga",
      ["schoolId", "section"]
    );
    expect(f).toMatchObject({ key: "district", value: "Banga", clears: ["schoolId", "section"] });
    expect(f.options).toEqual([
      { value: "Alamada", label: "Alamada", hint: "1 school" },
      { value: "Banga", label: "Banga", hint: "12 schools" },
    ]);
    expect(districtField([], undefined).value).toBe("");
  });

  it("schoolField labels by name and hints School ID and district", () => {
    const f = schoolField(SCHOOLS, undefined, ["section"]);
    expect(f.key).toBe("schoolId");
    expect(f.clears).toEqual(["section"]);
    expect(f.options[0]).toEqual({ value: "s1", label: "Naidas T. Opong ES", hint: "130554 · Alamada" });
    expect(f.options[1].hint).toBe("130555");
  });

  it("gradeField is a plain (non-searchable) select", () => {
    expect(gradeField([{ value: "G3", label: "Grade 3" }], "G3").searchable).toBeUndefined();
  });

  it("sectionField is disabled, and shows no stale value, until a school is chosen", () => {
    const f = sectionField([{ id: "sec1", name: "Rizal", grade: "G3" as const, gradeLabel: "Grade 3" }], "sec1", {
      schoolId: undefined,
      grade: undefined,
    });
    expect(f.disabledReason).toBe("Choose a school first.");
    expect(f.value).toBe("");
  });

  it("sectionField is enabled once a school is chosen and keeps its value", () => {
    const f = sectionField([{ id: "sec1", name: "Rizal", grade: "G3" as const, gradeLabel: "Grade 3" }], "sec1", {
      schoolId: "s1",
      grade: undefined,
    });
    expect(f.disabledReason).toBeUndefined();
    expect(f.value).toBe("sec1");
  });

  it("sectionField explains an empty school, and names the grade when one is chosen", () => {
    expect(sectionField([], undefined, { schoolId: "s1", grade: undefined }).disabledReason).toBe(
      "This school has no sections yet."
    );
    expect(sectionField([], undefined, { schoolId: "s1", grade: "G3" }).disabledReason).toBe(
      "This school has no sections in the chosen grade."
    );
  });

  it("yesNoField maps true/false/undefined to yes/no/none", () => {
    const labels = { all: "All", yes: "IP", no: "Non-IP" };
    expect(yesNoField("ip", "IP", true, labels).value).toBe("yes");
    expect(yesNoField("ip", "IP", false, labels).value).toBe("no");
    expect(yesNoField("ip", "IP", undefined, labels).value).toBe("");
  });
});
