import { describe, expect, it } from "vitest";
import { cellOf, rollUp } from "@/lib/summary/shape/rollup";
import { mean, pct } from "@/lib/summary/shape/pct";
import type { FacetRow, ScopeSchool, SummaryGroup } from "@/lib/summary/types";

/**
 * T16 / invariant I17: the division total equals the sum of the district rows
 * and of the school rows, because every level sums the same school-grain rows.
 */

function school(id: string, name: string, district: string | null): ScopeSchool {
  return {
    id,
    name,
    schoolIdCode: id.toUpperCase(),
    district,
    division: "Sarangani",
    region: "XII",
    isActive: true,
  };
}

const SCHOOLS = [
  school("s1", "Alabel CES", "Alabel 1"),
  school("s2", "Bagacay ES", "Alabel 1"),
  school("s3", "Glan CES", "Glan 1"),
  school("s4", "Nowhere ES", null),
];

function row(schoolId: string, gradeType: string | null, bucket: string, count: number): FacetRow {
  return { schoolId, gradeType, field: "gender", bucket, count };
}

const ROWS: FacetRow[] = [
  row("s1", "G3", "MALE", 10),
  row("s1", "G3", "FEMALE", 12),
  row("s1", "G4", "MALE", 5),
  row("s2", "G3", "FEMALE", 7),
  row("s3", "G5", "MALE", 3),
  row("s3", "G5", "FEMALE", 4),
  row("s4", "G3", "MALE", 2),
];

const BUCKETS = ["MALE", "FEMALE"];

function sumCells(groups: SummaryGroup[], bucket: string): number {
  return groups.reduce((n, g) => n + g.cells[bucket]!.count, 0);
}

describe("pct / mean", () => {
  it("rounds to one decimal", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(1, 8)).toBe(12.5);
  });

  it("is null, never 0 or NaN, when the base is 0", () => {
    expect(pct(0, 0)).toBeNull();
    expect(mean(0, 0)).toBeNull();
  });

  it("averages to one decimal", () => {
    expect(mean(250, 3)).toBe(83.3);
  });
});

describe("rollUp", () => {
  it("makes a single-choice row add up to 100%", () => {
    const [overall] = rollUp(ROWS, SCHOOLS, "overall", { byGrade: false, buckets: BUCKETS }).groups;
    expect(overall!.base).toBe(43);
    expect(overall!.cells.MALE!.count + overall!.cells.FEMALE!.count).toBe(overall!.base);
    expect(overall!.cells.MALE!.pct! + overall!.cells.FEMALE!.pct!).toBeCloseTo(100, 0);
  });

  it("district rows sum to the overall row, bucket by bucket (I17)", () => {
    const overall = rollUp(ROWS, SCHOOLS, "overall", { byGrade: false, buckets: BUCKETS }).groups;
    const districts = rollUp(ROWS, SCHOOLS, "district", { byGrade: false, buckets: BUCKETS }).groups;
    const schools = rollUp(ROWS, SCHOOLS, "school", { byGrade: false, buckets: BUCKETS }).groups;
    for (const b of BUCKETS) {
      expect(sumCells(districts, b)).toBe(overall[0]!.cells[b]!.count);
      expect(sumCells(schools, b)).toBe(overall[0]!.cells[b]!.count);
    }
    expect(districts.reduce((n, g) => n + g.base, 0)).toBe(overall[0]!.base);
  });

  it("lists districts by name with a trailing No district row", () => {
    const groups = rollUp(ROWS, SCHOOLS, "district", { byGrade: false, buckets: BUCKETS }).groups;
    expect(groups.map((g) => g.label)).toEqual(["Alabel 1", "Glan 1", "No district"]);
    expect(groups[0]!.cells.FEMALE!.count).toBe(19);
    expect(groups[2]!.district).toBeNull();
  });

  it("lists every school in scope, even one with no rows, with a null %", () => {
    const groups = rollUp(ROWS.filter((r) => r.schoolId !== "s2"), SCHOOLS, "school", {
      byGrade: false,
      buckets: BUCKETS,
    }).groups;
    const bagacay = groups.find((g) => g.schoolId === "s2")!;
    expect(bagacay.base).toBe(0);
    expect(bagacay.cells.MALE).toEqual({ count: 0, base: 0, pct: null });
  });

  it("drops rows for a school outside the scope's school list", () => {
    const leaked = [...ROWS, row("other-school", "G3", "MALE", 999)];
    const [overall] = rollUp(leaked, SCHOOLS, "overall", { byGrade: false, buckets: BUCKETS }).groups;
    expect(overall!.cells.MALE!.count).toBe(20);
  });

  it("splits by grade in grade order, with an All grades total that equals the grades' sum", () => {
    const groups = rollUp(ROWS, SCHOOLS, "overall", { byGrade: true, buckets: BUCKETS }).groups;
    expect(groups.map((g) => g.gradeLabel)).toEqual(["Grade 3", "Grade 4", "Grade 5", "All grades"]);
    const total = groups[groups.length - 1]!;
    expect(total.gradeType).toBeNull();
    const perGrade = groups.slice(0, -1);
    expect(perGrade.reduce((n, g) => n + g.base, 0)).toBe(total.base);
    // Grade 3: 10 + 12 (s1) + 7 (s2) + 2 (s4) = 31, of whom 19 female.
    expect(groups[0]!.cells.FEMALE).toEqual({ count: 19, base: 31, pct: 61.3 });
  });

  it("uses baseRows as the base for a multi-select section", () => {
    const subtype: FacetRow[] = [
      { schoolId: "s1", gradeType: "G3", field: "sub", bucket: "DECODING", count: 4 },
      { schoolId: "s1", gradeType: "G3", field: "sub", bucket: "COMPREHENSION_ALL", count: 3 },
    ];
    const population: FacetRow[] = [
      { schoolId: "s1", gradeType: "G3", field: "population", bucket: "ALL", count: 20 },
    ];
    const [overall] = rollUp(subtype, SCHOOLS, "overall", {
      byGrade: false,
      buckets: ["DECODING", "COMPREHENSION_ALL"],
      baseRows: population,
    }).groups;
    expect(overall!.base).toBe(20);
    expect(overall!.cells.DECODING).toEqual({ count: 4, base: 20, pct: 20 });
  });

  it("gives each cell its own base, and a mean, when rows carry them", () => {
    const rows: FacetRow[] = [
      { schoolId: "s1", gradeType: "G4", field: "subject", bucket: "area:ENGLISH", count: 2, base: 4, sum: 330 },
      { schoolId: "s3", gradeType: "G4", field: "subject", bucket: "area:ENGLISH", count: 1, base: 2, sum: 160 },
      { schoolId: "s3", gradeType: "G4", field: "subject", bucket: "area:MATHEMATICS", count: 0, base: 3, sum: 225 },
    ];
    const [overall] = rollUp(rows, SCHOOLS, "overall", {
      byGrade: false,
      buckets: ["area:ENGLISH", "area:MATHEMATICS"],
    }).groups;
    expect(overall!.cells["area:ENGLISH"]).toEqual({ count: 3, base: 6, pct: 50, mean: 81.7 });
    expect(overall!.cells["area:MATHEMATICS"]).toEqual({ count: 0, base: 3, pct: 0, mean: 75 });
  });

  it("cellOf zero-fills a bucket the group never saw", () => {
    const [overall] = rollUp(ROWS, SCHOOLS, "overall", { byGrade: false, buckets: BUCKETS }).groups;
    expect(cellOf(overall!, "UNKNOWN")).toEqual({ count: 0, base: 43, pct: 0 });
  });
});
