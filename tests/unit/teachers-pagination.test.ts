import { describe, expect, it } from "vitest";
import { parseTeachersListParams } from "@/lib/teachers/pagination";

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
