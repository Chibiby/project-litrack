import { describe, expect, it } from "vitest";
import { adjacentPages, listKey } from "@/lib/nav/list-params";

const LIST_KEYS = ["page", "sort", "q", "status"] as const;

describe("listKey", () => {
  it("is unchanged when a param outside `keys` changes", () => {
    const a = { page: "1", sort: "name", schoolId: "abc" };
    const b = { page: "1", sort: "name", schoolId: "xyz" };
    expect(listKey(a, LIST_KEYS)).toBe(listKey(b, LIST_KEYS));
  });

  it("changes when page changes", () => {
    const a = { page: "1", sort: "name" };
    const b = { page: "2", sort: "name" };
    expect(listKey(a, LIST_KEYS)).not.toBe(listKey(b, LIST_KEYS));
  });

  it("changes when sort changes", () => {
    const a = { page: "1", sort: "name" };
    const b = { page: "1", sort: "date" };
    expect(listKey(a, LIST_KEYS)).not.toBe(listKey(b, LIST_KEYS));
  });

  it("changes when q changes", () => {
    const a = { page: "1", q: "juan" };
    const b = { page: "1", q: "maria" };
    expect(listKey(a, LIST_KEYS)).not.toBe(listKey(b, LIST_KEYS));
  });

  it("changes when a declared facet changes", () => {
    const a = { page: "1", status: "ACTIVE" };
    const b = { page: "1", status: "ARCHIVED" };
    expect(listKey(a, LIST_KEYS)).not.toBe(listKey(b, LIST_KEYS));
  });

  it("is identical for the same logical list with params in a different order", () => {
    const a = { page: "1", sort: "name", q: "juan" };
    const b = { q: "juan", page: "1", sort: "name" };
    expect(listKey(a, LIST_KEYS)).toBe(listKey(b, LIST_KEYS));
  });

  it("yields the same key for an absent param and an empty-string param", () => {
    const withEmpty = { page: "1", q: "" };
    const withAbsent = { page: "1" };
    expect(listKey(withEmpty, LIST_KEYS)).toBe(listKey(withAbsent, LIST_KEYS));
  });

  it("handles an array-valued param deterministically regardless of order", () => {
    const a = { page: "1", status: ["ACTIVE", "PENDING"] };
    const b = { page: "1", status: ["PENDING", "ACTIVE"] };
    expect(listKey(a, LIST_KEYS)).toBe(listKey(b, LIST_KEYS));
  });

  it("distinguishes different array-valued params", () => {
    const a = { page: "1", status: ["ACTIVE"] };
    const b = { page: "1", status: ["ACTIVE", "PENDING"] };
    expect(listKey(a, LIST_KEYS)).not.toBe(listKey(b, LIST_KEYS));
  });

  it("accepts URLSearchParams and matches the equivalent plain-object key", () => {
    const obj = { page: "2", sort: "name" };
    const usp = new URLSearchParams("page=2&sort=name");
    expect(listKey(usp, LIST_KEYS)).toBe(listKey(obj, LIST_KEYS));
  });

  it("handles a duplicate-key URLSearchParams the same as an equivalent array", () => {
    const objArray = { page: "1", status: ["ACTIVE", "PENDING"] };
    const usp = new URLSearchParams("page=1&status=PENDING&status=ACTIVE");
    expect(listKey(usp, LIST_KEYS)).toBe(listKey(objArray, LIST_KEYS));
  });
});

describe("adjacentPages", () => {
  it("returns at most 2 entries and never includes the current page", () => {
    const result = adjacentPages(5, 10);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result).not.toContain(5);
    expect(result.sort()).toEqual([4, 6]);
  });

  it("clamps at the lower end (page 1 returns only the next page)", () => {
    expect(adjacentPages(1, 10)).toEqual([2]);
  });

  it("clamps at the upper end (last page returns only the previous page)", () => {
    expect(adjacentPages(10, 10)).toEqual([9]);
  });

  it("returns an empty array for a single-page list", () => {
    expect(adjacentPages(1, 1)).toEqual([]);
  });

  it("returns an empty array when totalPages is 0", () => {
    expect(adjacentPages(1, 0)).toEqual([]);
  });

  it("does not throw and stays in range for page 0", () => {
    const result = adjacentPages(0, 10);
    expect(() => result).not.toThrow();
    for (const p of result) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(10);
    }
  });

  it("does not throw and stays in range for page > totalPages", () => {
    const result = adjacentPages(99, 10);
    for (const p of result) {
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(10);
    }
    expect(result).toEqual([9]);
  });

  it("does not throw for non-integer input", () => {
    expect(() => adjacentPages(2.7, 10.9)).not.toThrow();
    const result = adjacentPages(2.7, 10.9);
    for (const p of result) {
      expect(Number.isInteger(p)).toBe(true);
    }
  });

  it("does not throw for negative totalPages", () => {
    expect(() => adjacentPages(1, -5)).not.toThrow();
    expect(adjacentPages(1, -5)).toEqual([]);
  });
});
