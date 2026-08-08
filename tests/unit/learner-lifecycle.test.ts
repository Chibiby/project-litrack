import { describe, expect, it } from "vitest";
import {
  normalizePersonName,
  learnerDuplicateKey,
  isPossibleDuplicate,
} from "@/lib/learners/normalize";
import {
  parseLearnerListParams,
  sectionIdWhere,
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
      section: "all",
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
    expect(p.section).toBe("all");
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

  it("parses section filter (all / none / id)", () => {
    expect(parseLearnerListParams({}).section).toBe("all");
    expect(parseLearnerListParams({ section: "" }).section).toBe("all");
    expect(parseLearnerListParams({ section: "all" }).section).toBe("all");
    expect(parseLearnerListParams({ section: "none" }).section).toBe("none");
    expect(parseLearnerListParams({ section: "NONE" }).section).toBe("none");
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(parseLearnerListParams({ section: id }).section).toBe(id);
  });
});

describe("sectionIdWhere", () => {
  it("maps list section filter to Prisma clause", () => {
    expect(sectionIdWhere("all")).toEqual({});
    expect(sectionIdWhere("none")).toEqual({ sectionId: null });
    expect(sectionIdWhere("sec-1")).toEqual({ sectionId: "sec-1" });
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
