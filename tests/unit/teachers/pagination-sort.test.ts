import { describe, expect, it } from "vitest";
import {
  TEACHER_LIST_SORTS,
  parseTeachersListParams,
  teacherListOrderBy,
} from "@/lib/teachers/pagination";

describe("TEACHER_LIST_SORTS.parse", () => {
  it("accepts each allow-listed sort value", () => {
    for (const option of TEACHER_LIST_SORTS.options) {
      expect(TEACHER_LIST_SORTS.parse(option.value)).toBe(option.value);
    }
  });

  it("falls back to alphabetical for garbage input", () => {
    expect(TEACHER_LIST_SORTS.parse("not-a-real-sort")).toBe("alphabetical");
  });

  it("falls back to alphabetical for undefined", () => {
    expect(TEACHER_LIST_SORTS.parse(undefined)).toBe("alphabetical");
  });
});

describe("parseTeachersListParams — sort", () => {
  it("defaults ?sort to alphabetical when omitted", () => {
    expect(parseTeachersListParams({}).sort).toBe("alphabetical");
  });

  it("threads a valid ?sort through and falls back on an unknown one", () => {
    expect(parseTeachersListParams({ sort: "date-added" }).sort).toBe("date-added");
    expect(parseTeachersListParams({ sort: "bogus" }).sort).toBe("alphabetical");
  });
});

describe("teacherListOrderBy — exhaustiveness and tiebreaker", () => {
  it("returns a non-empty orderBy array for every option", () => {
    for (const option of TEACHER_LIST_SORTS.options) {
      expect(teacherListOrderBy(option.value).length).toBeGreaterThan(0);
    }
  });

  it("every option's orderBy array terminates in the id tiebreaker", () => {
    for (const option of TEACHER_LIST_SORTS.options) {
      const orderBy = teacherListOrderBy(option.value);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("alphabetical orders by lastName then firstName, not fullName", () => {
    const orderBy = teacherListOrderBy("alphabetical");
    expect(orderBy[0]).toEqual({ lastName: "asc" });
    expect(orderBy[1]).toEqual({ firstName: "asc" });
    expect(orderBy).not.toContainEqual({ fullName: "asc" });
  });

  it("date-added orders newest first", () => {
    expect(teacherListOrderBy("date-added")[0]).toEqual({ createdAt: "desc" });
  });

  it("advisory-mode orders by the teacher profile's advisoryMode", () => {
    expect(teacherListOrderBy("advisory-mode")[0]).toEqual({
      teacherProfile: { advisoryMode: "asc" },
    });
  });
});
