import { describe, expect, it } from "vitest";
import { nameWordsWhere, parseRecordsPage, parseRecordsPageSize } from "@/lib/admin/records-pagination";

describe("records pagination helpers", () => {
  it("accepts only the offered page sizes", () => {
    expect(parseRecordsPageSize("25")).toBe(25);
    expect(parseRecordsPageSize("100")).toBe(100);
    expect(parseRecordsPageSize("7")).toBe(50);
    expect(parseRecordsPageSize(undefined)).toBe(50);
  });

  it("reads ?page= as a positive integer", () => {
    expect(parseRecordsPage("3")).toBe(3);
    expect(parseRecordsPage("0")).toBe(1);
    expect(parseRecordsPage("abc")).toBe(1);
  });

  it("matches every word of a Last, First search on its own", () => {
    expect(nameWordsWhere("Dela Cruz, Ruby")).toEqual({
      AND: ["Dela", "Cruz", "Ruby"].map((word) => ({ fullName: { contains: word, mode: "insensitive" } })),
    });
    expect(nameWordsWhere("  , ")).toEqual({});
    expect(nameWordsWhere(undefined)).toEqual({});
  });
});
