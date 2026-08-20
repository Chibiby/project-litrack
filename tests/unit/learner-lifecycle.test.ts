import { describe, expect, it } from "vitest";
import {
  normalizePersonName,
  learnerDuplicateKey,
  isPossibleDuplicate,
} from "@/lib/learners/normalize";
import {
  aralStatusWhere,
  genderWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  sectionIdWhere,
  totalPages,
  LEARNER_LIST_DEFAULT_PAGE_SIZE,
  LEARNER_PAGE_SIZE,
} from "@/lib/learners/pagination";
import { pageWindow } from "@/components/learners/learner-list-footer";
import { learnerInitials } from "@/components/learners/learner-avatar";

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
      grade: "all",
      gender: "all",
      aralStatus: "all",
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

describe("roster gender facet", () => {
  it("parses the two real values and falls back to all", () => {
    expect(parseLearnerListParams({ gender: "MALE" }).gender).toBe("MALE");
    expect(parseLearnerListParams({ gender: "female" }).gender).toBe("FEMALE");
    expect(parseLearnerListParams({ gender: "all" }).gender).toBe("all");
    expect(parseLearnerListParams({ gender: "xyz" }).gender).toBe("all");
    expect(parseLearnerListParams({}).gender).toBe("all");
  });

  it("maps to a Prisma clause", () => {
    expect(genderWhere("all")).toEqual({});
    expect(genderWhere("MALE")).toEqual({ gender: "MALE" });
    expect(genderWhere("FEMALE")).toEqual({ gender: "FEMALE" });
  });
});

describe("roster ARAL enrolment facet", () => {
  it("parses enrolled/not-enrolled and falls back to all", () => {
    expect(parseLearnerListParams({ aralStatus: "enrolled" }).aralStatus).toBe(
      "enrolled"
    );
    expect(
      parseLearnerListParams({ aralStatus: "NOT-ENROLLED" }).aralStatus
    ).toBe("not-enrolled");
    expect(parseLearnerListParams({ aralStatus: "nope" }).aralStatus).toBe("all");
    expect(parseLearnerListParams({}).aralStatus).toBe("all");
  });

  // The old "with"/"without" values filtered on the AralProfile relation, which
  // answered a different question — profiled, not enrolled. They are gone, so
  // they must fall back rather than quietly narrowing by the new meaning.
  it("does not honour the retired profile-presence values", () => {
    expect(parseLearnerListParams({ aralStatus: "with" }).aralStatus).toBe("all");
    expect(parseLearnerListParams({ aralStatus: "without" }).aralStatus).toBe(
      "all"
    );
  });

  it("maps the enrolment flag to a Prisma clause", () => {
    expect(aralStatusWhere("all")).toEqual({});
    expect(aralStatusWhere("enrolled")).toEqual({ isAralLearner: true });
    expect(aralStatusWhere("not-enrolled")).toEqual({ isAralLearner: false });
  });
});

describe("parseLearnerPageSize", () => {
  it("accepts only the offered sizes", () => {
    expect(parseLearnerPageSize("10")).toBe(10);
    expect(parseLearnerPageSize("50")).toBe(50);
    expect(parseLearnerPageSize("37")).toBe(LEARNER_LIST_DEFAULT_PAGE_SIZE);
    expect(parseLearnerPageSize("-5")).toBe(LEARNER_LIST_DEFAULT_PAGE_SIZE);
    expect(parseLearnerPageSize(undefined)).toBe(LEARNER_LIST_DEFAULT_PAGE_SIZE);
  });
});

describe("pageWindow", () => {
  it("lists every page while the run is short", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses long runs around the current page", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 19, 20]);
  });
});

describe("learnerInitials", () => {
  it("takes the first and last word, whatever the name shape", () => {
    expect(learnerInitials("Asriel Gabby B. Andrews")).toBe("AA");
    expect(learnerInitials("BRANDNLEE S HGOS")).toBe("BH");
    expect(learnerInitials("Madonna")).toBe("M");
    expect(learnerInitials("   ")).toBe("?");
  });
});
