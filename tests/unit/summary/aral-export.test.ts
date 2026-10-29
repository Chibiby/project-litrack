import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * ARAL learners and tutors export: one row per school (or district, or the
 * whole scope) with ARAL learners, DepEd tutors and Non-DepEd tutors first,
 * the tutor percentages after, and the per-grade learner counts last — in
 * place of the long Category/Count/Base/% blocks, which listed each school
 * once per grade and once per tutor type.
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

function grade(id: string, bucket: string, count: number): RawAralRow {
  return { school_id: id, field: "grade", bucket, employment_type: null, designation: null, count };
}
function tutor(id: string, employmentType: string | null, count: number): RawAralRow {
  return { school_id: id, field: "tutor", bucket: null, employment_type: employmentType, designation: null, count };
}

const RAW: RawAralRow[] = [
  grade("s1", "G3", 10),
  grade("s1", "G4", 5),
  grade("s2", "G3", 7),
  grade("s3", "G5", 3),
  tutor("s1", "DEPED_PLANTILLA", 2),
  tutor("s1", "NON_DEPED", 1),
  // No profile: neither DepEd nor Non-DepEd.
  tutor("s2", null, 1),
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

function shape(level: "overall" | "district" | "school", raw: RawAralRow[] = RAW) {
  return shapeAral({
    raw: scopeRaw("aral", raw, SCHOOLS),
    schools: SCHOOLS,
    level,
    computedAt: "2026-10-29T00:00:00.000Z",
  });
}

describe("ARAL export list", () => {
  it("at school level: one row per school, counts first, then percentages, then grades, then a Total row", () => {
    const list = shape("school").exportList!;
    expect(list.columns).toEqual([
      "School",
      "School ID",
      "District",
      "ARAL learners",
      "DepEd tutors",
      "Non-DepEd tutors",
      "Tutor type not answered",
      "Total tutors",
      "% DepEd",
      "% Non-DepEd",
      "Grade 3",
      "Grade 4",
      "Grade 5",
    ]);
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(list.rows).toHaveLength(4);
    expect(byName.get("Alabel CES")).toEqual(["Alabel CES", "code-s1", "Alabel 1", 15, 2, 1, 0, 3, 66.7, 33.3, 10, 5, 0]);
    expect(byName.get("Bagacay ES")).toEqual(["Bagacay ES", "code-s2", "Alabel 1", 7, 0, 0, 1, 1, 0, 0, 7, 0, 0]);
    // No tutors: a blank percentage, not a false 0%.
    expect(byName.get("Glan CES")).toEqual(["Glan CES", "code-s3", "Glan 1", 3, 0, 0, 0, 0, null, null, 0, 0, 3]);
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 25, 2, 1, 1, 4, 50, 25, 17, 5, 3]);
  });

  it("drops the not-answered column when every tutor is DepEd or Non-DepEd", () => {
    const list = shape("school", RAW.filter((r) => !(r.field === "tutor" && r.employment_type === null))).exportList!;
    expect(list.columns).not.toContain("Tutor type not answered");
    expect(list.rows.find((r) => r[0] === "Alabel CES")).toEqual(
      ["Alabel CES", "code-s1", "Alabel 1", 15, 2, 1, 3, 66.7, 33.3, 10, 5, 0]
    );
  });

  it("at district level: one row per district plus a Total row, no School ID column", () => {
    const list = shape("district").exportList!;
    expect(list.columns.slice(0, 2)).toEqual(["District", "ARAL learners"]);
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(byName.get("Alabel 1")?.slice(0, 5)).toEqual(["Alabel 1", 22, 2, 1, 1]);
    expect(byName.get("Glan 1")?.slice(0, 5)).toEqual(["Glan 1", 3, 0, 0, 0]);
    expect(list.rows.at(-1)?.[0]).toBe("Total");
  });

  it("overall: a single row and no Total row", () => {
    const list = shape("overall").exportList!;
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.slice(1, 5)).toEqual([25, 2, 1, 1]);
  });
});

describe("ARAL report table", () => {
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
