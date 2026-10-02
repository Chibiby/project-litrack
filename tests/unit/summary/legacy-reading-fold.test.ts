import { describe, expect, it } from "vitest";
import { learnerFacetRows } from "@/lib/summary/queries/learners";
import {
  readingLevelDistRows,
  type RawReadingLevelRow,
} from "@/lib/summary/queries/reading-levels";
import type { RawCountRow } from "@/lib/summary/queries/population";

/**
 * Grade 1-3 rows still holding the old combined INSTRUCTIONAL_DEVELOPING are
 * counted as DEVELOPING in the summary facets; Grade 4+ keep it. Pure shaping,
 * no Prisma.
 */

function raw(field: string, gt: string, bucket: string, count = 1): RawCountRow {
  return { school_id: "s1", gt, field, bucket, count };
}

describe("learnerFacetRows — legacy folding", () => {
  it.each(["G1", "G2", "G3"])("%s INSTRUCTIONAL_DEVELOPING becomes DEVELOPING (both languages)", (gt) => {
    const rows = learnerFacetRows([
      raw("filipinoProfile", gt, "INSTRUCTIONAL_DEVELOPING", 4),
      raw("englishProfile", gt, "INSTRUCTIONAL_DEVELOPING", 2),
    ]);
    expect(rows.map((r) => [r.field, r.bucket, r.count])).toEqual([
      ["filipinoProfile", "DEVELOPING", 4],
      ["englishProfile", "DEVELOPING", 2],
    ]);
  });

  it("G4 INSTRUCTIONAL_DEVELOPING stays INSTRUCTIONAL_DEVELOPING", () => {
    const rows = learnerFacetRows([raw("filipinoProfile", "G4", "INSTRUCTIONAL_DEVELOPING", 6)]);
    expect(rows[0].bucket).toBe("INSTRUCTIONAL_DEVELOPING");
  });

  it("does not rewrite non-profile fields", () => {
    const rows = learnerFacetRows([raw("parentEducation", "G2", "INSTRUCTIONAL_DEVELOPING")]);
    expect(rows[0].bucket).toBe("INSTRUCTIONAL_DEVELOPING");
  });

  it("leaves a real DEVELOPING / TRANSITIONING row untouched", () => {
    const rows = learnerFacetRows([
      raw("filipinoProfile", "G2", "DEVELOPING"),
      raw("filipinoProfile", "G2", "TRANSITIONING"),
    ]);
    expect(rows.map((r) => r.bucket)).toEqual(["DEVELOPING", "TRANSITIONING"]);
  });
});

function dist(gt: string, val: string, n: number, lang: "ENGLISH" | "FILIPINO" = "FILIPINO"): RawReadingLevelRow {
  return { kind: "dist", school_id: "s1", gt, month: "2026-08", lang, prev: null, val, n };
}

describe("readingLevelDistRows — legacy folding", () => {
  it("counts a G2 legacy Filipino row as DEVELOPING", () => {
    const rows = readingLevelDistRows([dist("G2", "INSTRUCTIONAL_DEVELOPING", 3)], "2026-08", "FILIPINO");
    expect(rows).toEqual([
      { schoolId: "s1", gradeType: "G2", field: "level", bucket: "DEVELOPING", count: 3 },
    ]);
  });

  it("counts a G3 legacy English row as DEVELOPING", () => {
    const rows = readingLevelDistRows(
      [dist("G3", "INSTRUCTIONAL_DEVELOPING", 2, "ENGLISH")],
      "2026-08",
      "ENGLISH"
    );
    expect(rows[0].bucket).toBe("DEVELOPING");
  });

  it("keeps INSTRUCTIONAL_DEVELOPING for G4", () => {
    const rows = readingLevelDistRows([dist("G4", "INSTRUCTIONAL_DEVELOPING", 5)], "2026-08", "FILIPINO");
    expect(rows[0].bucket).toBe("INSTRUCTIONAL_DEVELOPING");
  });
});
