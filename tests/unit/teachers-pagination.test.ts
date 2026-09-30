import { describe, expect, it } from "vitest";
import {
  parseTeachersListParams,
  resolveAdvisoryFacet,
  teacherAdvisoryFacetWhere,
} from "@/lib/teachers/pagination";

const GRADES = [
  { id: "g1", sections: [{ id: "s1" }, { id: "s2" }] },
  { id: "g2", sections: [{ id: "s3" }] },
];

describe("advisory grade/section facet", () => {
  it("parses grade and section, and drops section without grade", () => {
    expect(parseTeachersListParams({ grade: " g1 ", section: "s1" })).toMatchObject({
      grade: "g1",
      section: "s1",
    });
    expect(parseTeachersListParams({ section: "s1" })).toMatchObject({
      grade: "",
      section: "",
    });
    expect(parseTeachersListParams({ grade: "x".repeat(200) }).grade).toBe("");
  });

  it("accepts a grade and a section that belongs to it", () => {
    expect(resolveAdvisoryFacet(GRADES, "g1", "s2")).toEqual({
      gradeId: "g1",
      sectionId: "s2",
    });
    expect(resolveAdvisoryFacet(GRADES, "g1", "")).toEqual({
      gradeId: "g1",
      sectionId: null,
    });
  });

  it("ignores ids that are not this school's", () => {
    expect(resolveAdvisoryFacet(GRADES, "foreign", "s1")).toEqual({
      gradeId: null,
      sectionId: null,
    });
    expect(resolveAdvisoryFacet(GRADES, "g1", "foreign")).toEqual({
      gradeId: "g1",
      sectionId: null,
    });
    // A real section of another grade does not narrow this one.
    expect(resolveAdvisoryFacet(GRADES, "g1", "s3").sectionId).toBeNull();
    expect(resolveAdvisoryFacet(GRADES, "", "s1").gradeId).toBeNull();
  });

  it("builds a school-scoped live-section where, or null without a grade", () => {
    expect(teacherAdvisoryFacetWhere("sch", { gradeId: null, sectionId: null })).toBeNull();
    expect(
      teacherAdvisoryFacetWhere("sch", { gradeId: "g1", sectionId: null })
    ).toEqual({
      advisorySections: {
        some: {
          schoolId: "sch",
          deletedAt: null,
          gradeLevelId: "g1",
          gradeLevel: { schoolId: "sch", deletedAt: null },
        },
      },
    });
    expect(
      teacherAdvisoryFacetWhere("sch", { gradeId: "g1", sectionId: "s1" })
    ).toMatchObject({ advisorySections: { some: { id: "s1", schoolId: "sch" } } });
  });
});

describe("parseTeachersListParams", () => {
  it("accepts each School Head teacher roster filter", () => {
    for (const filter of [
      "non-deped-aral-volunteer",
      "teacher",
      "floating",
      "multi-advisory",
      "with-advisory",
    ]) {
      expect(parseTeachersListParams({ filter }).filter).toBe(filter);
    }
  });

  it("falls back to all for an unknown filter and preserves search paging", () => {
    expect(
      parseTeachersListParams({ page: "3", q: " Ana ", filter: "unknown" })
    ).toMatchObject({
      page: 3,
      skip: 40,
      take: 20,
      q: "Ana",
      filter: "all",
    });
  });
});
