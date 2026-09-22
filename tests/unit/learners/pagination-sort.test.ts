import { describe, expect, it } from "vitest";
import {
  LEARNER_LIST_SORTS,
  learnerListOrderBy,
  parseLearnerListParams,
} from "@/lib/learners/pagination";

describe("LEARNER_LIST_SORTS.parse", () => {
  it("accepts each allow-listed sort value", () => {
    for (const option of LEARNER_LIST_SORTS.options) {
      expect(LEARNER_LIST_SORTS.parse(option.value)).toBe(option.value);
    }
  });

  it("falls back to the default (Alphabetical / name) for garbage input", () => {
    expect(LEARNER_LIST_SORTS.parse("not-a-real-sort")).toBe("name");
  });

  it("falls back to the default for undefined", () => {
    expect(LEARNER_LIST_SORTS.parse(undefined)).toBe("name");
  });

  it("keeps resolving the two legacy bookmarked URL values", () => {
    expect(LEARNER_LIST_SORTS.parse("name")).toBe("name");
    expect(LEARNER_LIST_SORTS.parse("age")).toBe("age");
  });
});

describe("parseLearnerListParams — sort", () => {
  it("defaults ?sort to name (Alphabetical) when omitted", () => {
    expect(parseLearnerListParams({}).sort).toBe("name");
  });

  it("threads a valid ?sort through and falls back on an unknown one", () => {
    expect(parseLearnerListParams({ sort: "grade" }).sort).toBe("grade");
    expect(parseLearnerListParams({ sort: "bogus" }).sort).toBe("name");
  });
});

describe("learnerListOrderBy — exhaustiveness and tiebreaker", () => {
  it("returns a non-empty orderBy array for every option", () => {
    for (const option of LEARNER_LIST_SORTS.options) {
      expect(learnerListOrderBy(option.value).length).toBeGreaterThan(0);
    }
  });

  it("every option's orderBy array terminates in the id tiebreaker", () => {
    for (const option of LEARNER_LIST_SORTS.options) {
      const orderBy = learnerListOrderBy(option.value);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("Alphabetical orders by lastName then firstName, not fullName", () => {
    const orderBy = learnerListOrderBy("name");
    expect(orderBy[0]).toEqual({ lastName: "asc" });
    expect(orderBy[1]).toEqual({ firstName: "asc" });
    expect(orderBy).not.toContainEqual({ fullName: "asc" });
  });

  it("age orders youngest first, then surname-first as a tiebreaker", () => {
    const orderBy = learnerListOrderBy("age");
    expect(orderBy[0]).toEqual({ age: "asc" });
    expect(orderBy).toContainEqual({ lastName: "asc" });
  });

  it("grade level orders by the grade relation's type", () => {
    expect(learnerListOrderBy("grade")[0]).toEqual({
      gradeLevel: { type: "asc" },
    });
  });

  it("section orders by the section relation's name", () => {
    expect(learnerListOrderBy("section")[0]).toEqual({
      section: { name: "asc" },
    });
  });

  it("date-added orders newest first", () => {
    expect(learnerListOrderBy("date-added")[0]).toEqual({ createdAt: "desc" });
  });

  it("reading-level orders by the ReadingProfile enum's declaration (rubric) order", () => {
    expect(learnerListOrderBy("reading-level")[0]).toEqual({
      filipinoReadingProfile: "asc",
    });
  });

  it("aral-status orders enrolled learners first", () => {
    expect(learnerListOrderBy("aral-status")[0]).toEqual({
      isAralLearner: "desc",
    });
  });
});
