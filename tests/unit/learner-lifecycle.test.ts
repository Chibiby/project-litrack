import { describe, expect, it } from "vitest";
import {
  normalizePersonName,
  learnerDuplicateKey,
  isPossibleDuplicate,
} from "@/lib/learners/normalize";
import {
  parseLearnerListParams,
  totalPages,
  LEARNER_PAGE_SIZE,
} from "@/lib/learners/pagination";

describe("normalizePersonName", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizePersonName("  Ana  Marie  ")).toBe("ana marie");
    expect(normalizePersonName("JUAN")).toBe("juan");
    expect(normalizePersonName("")).toBe("");
  });
});

describe("learnerDuplicateKey / isPossibleDuplicate", () => {
  it("matches case-insensitive and trimmed names with same age", () => {
    expect(
      learnerDuplicateKey(" Ana ", "SANTOS", 10)
    ).toBe("ana|santos|10");

    expect(
      isPossibleDuplicate(
        { firstName: "Ana", lastName: "Santos", age: 10 },
        { firstName: " ana ", lastName: "SANTOS", age: 10 }
      )
    ).toBe(true);
  });

  it("does not match different age or different last name", () => {
    expect(
      isPossibleDuplicate(
        { firstName: "Ana", lastName: "Santos", age: 10 },
        { firstName: "Ana", lastName: "Santos", age: 11 }
      )
    ).toBe(false);

    expect(
      isPossibleDuplicate(
        { firstName: "Ana", lastName: "Santos", age: 10 },
        { firstName: "Ana", lastName: "Cruz", age: 10 }
      )
    ).toBe(false);
  });
});

describe("parseLearnerListParams", () => {
  it("applies defaults", () => {
    const p = parseLearnerListParams({});
    expect(p).toEqual({
      page: 1,
      pageSize: LEARNER_PAGE_SIZE,
      skip: 0,
      take: LEARNER_PAGE_SIZE,
      q: "",
      filter: "all",
      sort: "name",
    });
  });

  it("parses page, q, filter, and sort", () => {
    const p = parseLearnerListParams({
      page: "3",
      q: "  ana  ",
      filter: "aral",
      sort: "age",
    });
    expect(p.page).toBe(3);
    expect(p.skip).toBe(40);
    expect(p.take).toBe(20);
    expect(p.q).toBe("ana");
    expect(p.filter).toBe("aral");
    expect(p.sort).toBe("age");
  });

  it("falls back on invalid page/filter/sort", () => {
    const p = parseLearnerListParams({
      page: "0",
      filter: "unknown",
      sort: "xyz",
    });
    expect(p.page).toBe(1);
    expect(p.filter).toBe("all");
    expect(p.sort).toBe("name");
  });

  it("accepts archived filter", () => {
    expect(parseLearnerListParams({ filter: "archived" }).filter).toBe(
      "archived"
    );
  });
});

describe("totalPages", () => {
  it("returns at least 1", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(1)).toBe(1);
    expect(totalPages(20)).toBe(1);
    expect(totalPages(21)).toBe(2);
    expect(totalPages(40, 20)).toBe(2);
  });
});
