import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

let capturedOptions: { keyParts: string[] } | undefined;
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: vi.fn((fn: () => unknown, options: { keyParts: string[] }) => {
    capturedOptions = options;
    return fn();
  }),
}));
vi.mock("@/lib/cache/tags", () => ({ schoolsList: "schools-list" }));

import {
  parseSchoolsListParams,
  getSchoolsListPage,
  schoolsListOrderBy,
  SCHOOLS_LIST_SORTS,
  type SchoolsListParams,
} from "@/lib/cache/schools-list";

describe("parseSchoolsListParams", () => {
  it("accepts active and inactive status filters", () => {
    expect(parseSchoolsListParams({ status: "active" }).status).toBe("active");
    expect(parseSchoolsListParams({ status: "inactive" }).status).toBe("inactive");
  });

  it("ignores unsupported status values and trims the other filters", () => {
    expect(
      parseSchoolsListParams({ q: "  Opong ", region: " Region XII ", status: "paused" })
    ).toMatchObject({ q: "Opong", region: "Region XII", status: "" });
  });

  it("defaults sort to alphabetical (school name), not the old createdAt-desc default", () => {
    expect(parseSchoolsListParams({}).sort).toBe("alphabetical");
    expect(SCHOOLS_LIST_SORTS.fallback).toBe("alphabetical");
  });

  it("falls back to alphabetical on garbage or undefined sort values", () => {
    expect(parseSchoolsListParams({ sort: "not-a-real-option" }).sort).toBe("alphabetical");
    expect(parseSchoolsListParams({ sort: undefined }).sort).toBe("alphabetical");
    expect(parseSchoolsListParams({}).sort).toBe("alphabetical");
  });

  it("accepts every declared sort option case-insensitively", () => {
    for (const option of SCHOOLS_LIST_SORTS.options) {
      expect(parseSchoolsListParams({ sort: option.value.toUpperCase() }).sort).toBe(
        option.value
      );
    }
  });
});

describe("schoolsListOrderBy", () => {
  it("terminates every sort option in the unique { id: 'asc' } tiebreaker", () => {
    for (const option of SCHOOLS_LIST_SORTS.options) {
      const orderBy = schoolsListOrderBy(option.value);
      expect(orderBy.length).toBeGreaterThan(0);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("gives every option a non-empty primary clause ahead of the tiebreaker", () => {
    for (const option of SCHOOLS_LIST_SORTS.options) {
      const orderBy = schoolsListOrderBy(option.value);
      // At least a primary clause plus the id tiebreaker.
      expect(orderBy.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("getSchoolsListPage cache key — cache-poisoning guard", () => {
  /**
   * Two params differing ONLY in `sort` must resolve to different
   * `keyParts`, or `unstable_cache` serves one sort's page under the other
   * sort's URL. This is the exact bug `06_AGENTS.md`'s caching section
   * warns about: remove `sort` from `keyParts` and this test goes red.
   */
  it("produces different keyParts for the same params with a different sort", async () => {
    const base: SchoolsListParams = {
      page: 1,
      pageSize: 10,
      skip: 0,
      take: 10,
      q: "",
      region: "",
      status: "",
      sort: "alphabetical",
    };

    const prismaMock = await import("@/lib/prisma");
    (prismaMock.prisma as unknown as { school: unknown }).school = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };

    await getSchoolsListPage(base);
    const alphabeticalKey = capturedOptions?.keyParts;

    await getSchoolsListPage({ ...base, sort: "date-added" });
    const dateAddedKey = capturedOptions?.keyParts;

    expect(alphabeticalKey).toBeDefined();
    expect(dateAddedKey).toBeDefined();
    expect(alphabeticalKey).not.toEqual(dateAddedKey);
  });
});
