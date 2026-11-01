import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * ARAL learners export: one row per school (or district, or the whole scope)
 * with the ARAL learner count first, then per grade a learner count and its %
 * of the row's learners, in place of the long Category/Count/Base/% blocks. At
 * school and district level a bold Total row closes the list when there is
 * more than one row, its percentages recomputed from the summed counts. The
 * teachers export is covered in aral-teachers.test.ts.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { shapeAral } = await import("@/lib/summary/queries/aral");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
type RawAralRow = import("@/lib/summary/queries/aral").RawAralRow;

function school(id: string, name: string, district: string | null): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: "Sarangani", region: "XII", isActive: true };
}

const SCHOOLS = [
  school("s1", "Alabel CES", "Alabel 1"),
  school("s2", "Bagacay ES", "Alabel 1"),
  school("s3", "Glan CES", "Glan 1"),
];
/** The same plus a school with no ARAL learners at all. */
const SCHOOLS_WITH_EMPTY = [...SCHOOLS, school("s4", "Empty ES", "Glan 1")];

function grade(id: string, bucket: string, count: number): RawAralRow {
  return { school_id: id, field: "grade", bucket, employment_type: null, designation: null, count };
}
function teacher(id: string, employmentType: string | null, count: number): RawAralRow {
  return { school_id: id, field: "teacher", bucket: null, employment_type: employmentType, designation: null, count };
}

const RAW: RawAralRow[] = [
  grade("s1", "G3", 10),
  grade("s1", "G4", 5),
  grade("s2", "G3", 7),
  grade("s3", "G5", 3),
  // Teacher rows are never part of the learners export.
  teacher("s1", "DEPED_PLANTILLA", 2),
  teacher("s2", null, 1),
];

const FRAME: ReportFrame = {
  schoolName: "Division-wide (3 schools)",
  schoolIdCode: "",
  region: "XII",
  division: "Sarangani",
  district: "",
  address: "",
  schoolYearLabel: "",
  schoolHeadName: "",
  preparedBy: "Admin",
};

function shape(
  level: "overall" | "district" | "school",
  raw: RawAralRow[] = RAW,
  schools: ScopeSchool[] = SCHOOLS
) {
  return shapeAral({
    raw: scopeRaw("aral", raw, schools),
    schools,
    level,
    computedAt: "2026-10-29T00:00:00.000Z",
  });
}

describe("ARAL learners export list", () => {
  it("at school level: one row per school, the learner count first, then a count and % per grade, then a Total row", () => {
    const list = shape("school").exportList!;
    expect(list.columns).toEqual([
      "School",
      "School ID",
      "District",
      "ARAL learners",
      "Grade 3",
      "Grade 3 %",
      "Grade 4",
      "Grade 4 %",
      "Grade 5",
      "Grade 5 %",
    ]);
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(list.rows).toHaveLength(4);
    expect(byName.get("Alabel CES")).toEqual(["Alabel CES", "code-s1", "Alabel 1", 15, 10, 66.7, 5, 33.3, 0, 0]);
    expect(byName.get("Bagacay ES")).toEqual(["Bagacay ES", "code-s2", "Alabel 1", 7, 7, 100, 0, 0, 0, 0]);
    expect(byName.get("Glan CES")).toEqual(["Glan CES", "code-s3", "Glan 1", 3, 0, 0, 0, 0, 3, 100]);
    // Recomputed from the summed counts, not an average of the rows' percentages.
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 25, 17, 68, 5, 20, 3, 12]);
  });

  it("has no teacher columns and no teacher-derived numbers", () => {
    const list = shape("school").exportList!;
    expect(list.columns.join("|")).not.toMatch(/teacher|DepEd/i);
    expect(list.id).toBe("aral-learners-per-school");
  });

  it("a row with no ARAL learners has a blank (null) % per grade, not a false 0%", () => {
    const list = shape("school", RAW, SCHOOLS_WITH_EMPTY).exportList!;
    const empty = list.rows.find((r) => r[0] === "Empty ES")!;
    expect(empty).toEqual(["Empty ES", "code-s4", "Glan 1", 0, 0, null, 0, null, 0, null]);
    // The empty school does not disturb the Total row.
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 25, 17, 68, 5, 20, 3, 12]);
  });

  it("at district level: one row per district plus a Total row, no School ID column", () => {
    const list = shape("district").exportList!;
    expect(list.columns.slice(0, 2)).toEqual(["District", "ARAL learners"]);
    expect(list.columns).not.toContain("School ID");
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(byName.get("Alabel 1")).toEqual(["Alabel 1", 22, 17, 77.3, 5, 22.7, 0, 0]);
    expect(byName.get("Glan 1")).toEqual(["Glan 1", 3, 0, 0, 0, 0, 3, 100]);
    expect(list.rows.at(-1)).toEqual(["Total", 25, 17, 68, 5, 20, 3, 12]);
  });

  it("no Total row when a level has a single row", () => {
    const one = [SCHOOLS[2]!];
    const list = shape("school", RAW, one).exportList!;
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.[0]).toBe("Glan CES");
  });

  it("overall: a single row and no Total row", () => {
    const list = shape("overall").exportList!;
    expect(list.columns[0]).toBe("Scope");
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.slice(1)).toEqual([25, 17, 68, 5, 20, 3, 12]);
  });
});

describe("ARAL learners report table", () => {
  it("replaces the Category/Count blocks with the one-row-per-school block, Total row bold", () => {
    const table = SUMMARY_FACETS.aral.toReportTable(shape("school"), FRAME);
    expect(table.blocks).toHaveLength(1);
    const block = table.blocks![0]!;
    expect(block.columns.map((c) => c.header)).not.toContain("Category");
    expect(block.rows).toHaveLength(4);
    expect(block.boldRowIndices).toEqual([3]);
  });

  it("overall has no bold row", () => {
    const table = SUMMARY_FACETS.aral.toReportTable(shape("overall"), FRAME);
    expect(table.blocks![0]!.boldRowIndices).toBeUndefined();
  });
});
