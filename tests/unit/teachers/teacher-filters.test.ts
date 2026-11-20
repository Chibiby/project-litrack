import { describe, expect, it } from "vitest";
import {
  facetScopeLabels,
  parseTeacherFacets,
  teacherFacetWhere,
} from "@/lib/teachers/teacher-filters";

describe("parseTeacherFacets", () => {
  it("keeps known values and drops unknown ones", () => {
    expect(parseTeacherFacets({ advisory: "multi", type: "deped-aral", status: "pending" })).toEqual({
      advisory: "multi",
      teacherType: "deped-aral",
      status: "pending",
    });
    expect(parseTeacherFacets({ advisory: "x", type: "y", status: "z" })).toEqual({
      advisory: undefined,
      teacherType: undefined,
      status: undefined,
    });
  });
});

describe("teacherFacetWhere", () => {
  it("adds nothing when no facet is chosen", () => {
    expect(teacherFacetWhere({})).toEqual([]);
  });

  it("adds one fragment per chosen facet", () => {
    expect(teacherFacetWhere({ advisory: "one", teacherType: "aral", status: "active" })).toHaveLength(3);
  });

  it("counts an ARAL tutor by live ARAL learners only", () => {
    expect(teacherFacetWhere({ teacherType: "aral" })).toEqual([
      { aralLearners: { some: { deletedAt: null, archivedAt: null, isAralLearner: true } } },
    ]);
    expect(teacherFacetWhere({ teacherType: "not-aral" })).toEqual([
      { aralLearners: { none: { deletedAt: null, archivedAt: null, isAralLearner: true } } },
    ]);
  });

  it("reads a volunteer from employment type first, then the designation", () => {
    expect(teacherFacetWhere({ teacherType: "volunteer" })).toEqual([
      {
        teacherProfile: {
          is: {
            OR: [
              { employmentType: "NON_DEPED" },
              { employmentType: null, designation: "Non-DepEd ARAL Volunteer" },
            ],
          },
        },
      },
    ]);
  });

  it("leaves volunteers out of a declared advisory mode", () => {
    const [where] = teacherFacetWhere({ advisory: "multi" });
    expect(JSON.stringify(where)).toContain("MULTI_GRADE");
    expect(JSON.stringify(where)).toContain("NOT");
  });

  it("splits sections held from none held, live sections only", () => {
    expect(teacherFacetWhere({ advisory: "with-section" })).toEqual([
      { advisorySections: { some: { deletedAt: null } } },
    ]);
    expect(teacherFacetWhere({ advisory: "no-section" })).toEqual([
      { advisorySections: { none: { deletedAt: null } } },
    ]);
  });
});

describe("facetScopeLabels", () => {
  it("names the chosen facets in plain words", () => {
    expect(facetScopeLabels({ advisory: "floating", teacherType: "volunteer" })).toEqual([
      "Floating",
      "Non-DepEd ARAL volunteers",
    ]);
    expect(facetScopeLabels(undefined)).toEqual([]);
  });
});
