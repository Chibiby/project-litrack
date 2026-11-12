import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import { NOT_ANSWERED } from "@/lib/summary/shape/section";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Facet `aral-teachers` (ARAL teachers): teachers currently designated ARAL teacher,
 * DepEd / Non-DepEd / Not answered, overall and per grade level.
 *
 * Counting rule (operator decision 2026-11-01): a teacher is counted under every
 * grade where they teach at least one ARAL learner, so grade totals can exceed
 * the row's Total teachers; a teacher counts once in Total teachers. Teachers whose
 * type is not answered count in a grade's Total only. Pure shaping, no Prisma.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { aralFacetRows, shapeAralTeachers } = await import("@/lib/summary/queries/aral");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
type RawAralRow = import("@/lib/summary/queries/aral").RawAralRow;

function school(id: string, name: string, district: string | null): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: "Sarangani", region: "XII", isActive: true };
}

const S1 = school("s1", "Alabel CES", "Alabel 1");
const S2 = school("s2", "Bagacay ES", "Alabel 1");
const S3 = school("s3", "Glan CES", "Glan 1");
const SCHOOLS = [S1, S2, S3];

const DEPED = "DEPED_PLANTILLA";
const NON = "NON_DEPED";

function teacher(id: string, employmentType: string | null, count: number): RawAralRow {
  return { school_id: id, field: "teacher", bucket: null, employment_type: employmentType, designation: null, count };
}
function teacherGrade(id: string, bucket: string, employmentType: string | null, count: number): RawAralRow {
  return { school_id: id, field: "teacherGrade", bucket, employment_type: employmentType, designation: null, count };
}
function learners(id: string, bucket: string, count: number): RawAralRow {
  return { school_id: id, field: "grade", bucket, employment_type: null, designation: null, count };
}

/**
 * s1: T1 DepEd teaches Grade 2 AND Grade 3; T2 Non-DepEd teaches Grade 3; T3 has
 * no teacher type and teaches Grade 3. => 3 teachers, Grade 2 has 1, Grade 3 has 3.
 * s2: two Non-DepEd teachers, both Grade 2. s3: no teachers at all.
 */
const RAW: RawAralRow[] = [
  teacher("s1", DEPED, 1),
  teacher("s1", NON, 1),
  teacher("s1", null, 1),
  teacherGrade("s1", "G2", DEPED, 1),
  teacherGrade("s1", "G3", DEPED, 1),
  teacherGrade("s1", "G3", NON, 1),
  teacherGrade("s1", "G3", null, 1),
  teacher("s2", NON, 2),
  teacherGrade("s2", "G2", NON, 2),
  // Learner rows belong to the learners facet; they must not move any teacher figure.
  learners("s1", "G5", 40),
  learners("s3", "G6", 12),
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
  return shapeAralTeachers({
    raw: scopeRaw("aral-teachers", raw, schools),
    schools,
    level,
    computedAt: "2026-10-29T00:00:00.000Z",
  });
}

const section = (r: ReturnType<typeof shape>, id: string) => r.sections.find((s) => s.id === id)!;
const overallCells = (r: ReturnType<typeof shape>, id: string) =>
  section(r, id).table.groups.find((g) => g.key === "overall")!.cells;

describe("aralFacetRows: teacherGrade rows", () => {
  it("counts a teacher in the grade's TOTAL and in the matching DepEd / Non-DepEd bucket", () => {
    const rows = aralFacetRows([teacherGrade("s1", "G3", DEPED, 2), teacherGrade("s1", "G3", NON, 1)]);
    const get = (bucket: string) => rows.find((r) => r.field === "teacherGrade" && r.bucket === bucket)?.count;
    expect(get("G3|TOTAL")).toBe(3);
    expect(get("G3|DEPED")).toBe(2);
    expect(get("G3|NON_DEPED")).toBe(1);
  });

  it("a Not answered teacher adds to the grade's TOTAL only", () => {
    const rows = aralFacetRows([teacherGrade("s1", "G3", null, 4)]);
    expect(rows.map((r) => [r.bucket, r.count])).toEqual([["G3|TOTAL", 4]]);
  });

  it("sums two raw pairs that classify the same way, per school and grade", () => {
    const rows = aralFacetRows([
      { ...teacherGrade("s1", "G2", DEPED, 2) },
      { ...teacherGrade("s1", "G2", null, 1), designation: "Master Teacher I" },
      teacherGrade("s2", "G2", DEPED, 5),
    ]);
    const find = (school: string, bucket: string) =>
      rows.find((r) => r.schoolId === school && r.bucket === bucket)?.count;
    expect(find("s1", "G2|DEPED")).toBe(3);
    expect(find("s1", "G2|TOTAL")).toBe(3);
    expect(find("s2", "G2|DEPED")).toBe(5);
  });

  it("keeps teacher and teacherGrade as separate fields", () => {
    const rows = aralFacetRows([teacher("s1", DEPED, 1), teacherGrade("s1", "G2", DEPED, 1)]);
    expect(rows.filter((r) => r.field === "teacher")).toHaveLength(1);
    expect(rows.filter((r) => r.field === "teacherGrade")).toHaveLength(2);
  });
});

describe("shapeAralTeachers", () => {
  const result = shape("overall");

  it("returns the aral-teachers facetId, title and a teachers + per-grade section", () => {
    expect(result.facetId).toBe("aral-teachers");
    expect(result.title).toBe("ARAL teachers");
    expect(result.sections.map((s) => s.id)).toEqual(["teachers", "teachersByGrade"]);
  });

  it("never puts a name, email or contact number in the result", () => {
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(blob).not.toMatch(/"(firstName|lastName|fullName|contactNumber)"/);
  });

  it("Total teachers: DepEd, Non-DepEd and Not answered, each teacher once", () => {
    const cells = overallCells(result, "teachers");
    expect(cells.DEPED!.count).toBe(1);
    expect(cells.NON_DEPED!.count).toBe(3);
    expect(cells[NOT_ANSWERED]!.count).toBe(1);
    expect(section(result, "teachers").table.groups[0]!.base).toBe(5);
  });

  it("one teacher with learners in Grade 2 and Grade 3 is in both grades' TOTAL and DepEd, but once in Total teachers", () => {
    const raw = [teacher("s1", DEPED, 1), teacherGrade("s1", "G2", DEPED, 1), teacherGrade("s1", "G3", DEPED, 1)];
    const r = shape("overall", raw);
    const grades = overallCells(r, "teachersByGrade");
    expect(grades["G2|TOTAL"]!.count).toBe(1);
    expect(grades["G2|DEPED"]!.count).toBe(1);
    expect(grades["G2|NON_DEPED"]!.count).toBe(0);
    expect(grades["G3|TOTAL"]!.count).toBe(1);
    expect(grades["G3|DEPED"]!.count).toBe(1);
    expect(grades["G3|NON_DEPED"]!.count).toBe(0);
    const total = section(r, "teachers").table.groups[0]!;
    expect(total.base).toBe(1);
    expect(total.cells.DEPED!.count).toBe(1);
  });

  it("a one-teacher-in-two-grades Non-DepEd teacher lands in the Non-DepEd bucket of both grades", () => {
    const raw = [teacher("s1", NON, 1), teacherGrade("s1", "G2", NON, 1), teacherGrade("s1", "G3", NON, 1)];
    const grades = overallCells(shape("overall", raw), "teachersByGrade");
    expect(grades["G2|NON_DEPED"]!.count).toBe(1);
    expect(grades["G3|NON_DEPED"]!.count).toBe(1);
    expect(grades["G2|DEPED"]!.count).toBe(0);
  });

  it("grade totals can exceed Total teachers (the scenario: 5 teachers, 3 + 3 grade totals)", () => {
    const grades = overallCells(result, "teachersByGrade");
    expect(grades["G2|TOTAL"]!.count).toBe(3);
    expect(grades["G3|TOTAL"]!.count).toBe(3);
    expect(grades["G2|DEPED"]!.count).toBe(1);
    expect(grades["G2|NON_DEPED"]!.count).toBe(2);
    expect(grades["G3|DEPED"]!.count).toBe(1);
    expect(grades["G3|NON_DEPED"]!.count).toBe(1);
  });

  it("Not answered teachers count in a grade's TOTAL only: Total exceeds DepEd + Non-DepEd", () => {
    const grades = overallCells(result, "teachersByGrade");
    expect(grades["G3|TOTAL"]!.count).toBe(grades["G3|DEPED"]!.count + grades["G3|NON_DEPED"]!.count + 1);
    const ids = section(result, "teachersByGrade").buckets.map((b) => b.id);
    expect(ids.some((id) => id.includes("NOT_ANSWERED") || id.includes("Not answered"))).toBe(false);
  });

  it("only grades with teachers get buckets (learner-only grades G5 and G6 do not), Total / DepEd / Non-DepEd each, in enum order", () => {
    const ids = section(result, "teachersByGrade").buckets.map((b) => b.id);
    expect(ids).toEqual([
      "G2|TOTAL",
      "G2|DEPED",
      "G2|NON_DEPED",
      "G3|TOTAL",
      "G3|DEPED",
      "G3|NON_DEPED",
    ]);
  });

  it("falls back to every grade when no teacher has a grade", () => {
    const r = shape("overall", []);
    const ids = section(r, "teachersByGrade").buckets.map((b) => b.id);
    expect(ids).toHaveLength(14 * 3);
    expect(ids[0]).toBe("KINDER|TOTAL");
  });

  it("school level keeps one row per school with that school's own grade counts", () => {
    const r = shape("school");
    const byId = (id: string) => section(r, "teachersByGrade").table.groups.find((g) => g.schoolId === id)!;
    expect(byId("s1").cells["G2|TOTAL"]!.count).toBe(1);
    expect(byId("s1").cells["G3|TOTAL"]!.count).toBe(3);
    expect(byId("s2").cells["G2|NON_DEPED"]!.count).toBe(2);
    expect(byId("s3").cells["G2|TOTAL"]!.count).toBe(0);
  });
});

describe("ARAL teachers export list", () => {
  it("at school level: counts first, then teacher %, then per grade Total / DepEd / Non-DepEd, then a Total row", () => {
    const list = shape("school").exportList!;
    expect(list.id).toBe("aral-teachers-per-school");
    expect(list.columns).toEqual([
      "School",
      "School ID",
      "District",
      "DepEd ARAL teachers",
      "Non-DepEd ARAL teachers",
      "Not answered",
      "Total ARAL teachers",
      "% DepEd",
      "% Non-DepEd",
      "Grade 2 ARAL teachers",
      "Grade 2 DepEd",
      "Grade 2 Non-DepEd",
      "Grade 3 ARAL teachers",
      "Grade 3 DepEd",
      "Grade 3 Non-DepEd",
    ]);
    expect(list.columns).not.toContain("ARAL learners");
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(list.rows).toHaveLength(4);
    expect(byName.get("Alabel CES")).toEqual(["Alabel CES", "code-s1", "Alabel 1", 1, 1, 1, 3, 33.3, 33.3, 1, 1, 0, 3, 1, 1]);
    expect(byName.get("Bagacay ES")).toEqual(["Bagacay ES", "code-s2", "Alabel 1", 0, 2, 0, 2, 0, 100, 2, 0, 2, 0, 0, 0]);
    // No teachers: a blank percentage, not a false 0%.
    expect(byName.get("Glan CES")).toEqual(["Glan CES", "code-s3", "Glan 1", 0, 0, 0, 0, null, null, 0, 0, 0, 0, 0, 0]);
    // Sums of the rows' counts, percentages recomputed from them (not averaged).
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 1, 3, 1, 5, 20, 60, 3, 1, 2, 3, 1, 1]);
  });

  it("the Total row's grade columns are sums of the rows, not recounted teachers", () => {
    // One teacher in both grades: Total teachers 1, but the grade columns add to 2.
    const raw = [teacher("s1", DEPED, 1), teacherGrade("s1", "G2", DEPED, 1), teacherGrade("s1", "G3", DEPED, 1)];
    const list = shape("school", raw, [S1, S2]).exportList!;
    const total = list.rows.at(-1)!;
    const col = (name: string) => list.columns.indexOf(name);
    expect(total[col("Total ARAL teachers")]).toBe(1);
    expect(total[col("Grade 2 ARAL teachers")]).toBe(1);
    expect(total[col("Grade 3 ARAL teachers")]).toBe(1);
  });

  it("drops the not-answered column when every teacher is DepEd or Non-DepEd, keeping the grade columns aligned", () => {
    const raw = RAW.filter((r) => !(r.employment_type === null && (r.field === "teacher" || r.field === "teacherGrade")));
    const list = shape("school", raw).exportList!;
    expect(list.columns).not.toContain("Not answered");
    expect(list.columns.slice(3, 8)).toEqual([
      "DepEd ARAL teachers",
      "Non-DepEd ARAL teachers",
      "Total ARAL teachers",
      "% DepEd",
      "% Non-DepEd",
    ]);
    expect(list.rows.find((r) => r[0] === "Alabel CES")).toEqual(
      ["Alabel CES", "code-s1", "Alabel 1", 1, 1, 2, 50, 50, 1, 1, 0, 2, 1, 1]
    );
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 1, 3, 4, 25, 75, 3, 1, 2, 2, 1, 1]);
  });

  it("at district level: one row per district plus a Total row, no School ID column", () => {
    const list = shape("district").exportList!;
    expect(list.columns.slice(0, 2)).toEqual(["District", "DepEd ARAL teachers"]);
    expect(list.columns).not.toContain("School ID");
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(byName.get("Alabel 1")).toEqual(["Alabel 1", 1, 3, 1, 5, 20, 60, 3, 1, 2, 3, 1, 1]);
    expect(byName.get("Glan 1")).toEqual(["Glan 1", 0, 0, 0, 0, null, null, 0, 0, 0, 0, 0, 0]);
    expect(list.rows.at(-1)).toEqual(["Total", 1, 3, 1, 5, 20, 60, 3, 1, 2, 3, 1, 1]);
  });

  it("overall: a single row and no Total row", () => {
    const list = shape("overall").exportList!;
    expect(list.columns[0]).toBe("Scope");
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.slice(1)).toEqual([1, 3, 1, 5, 20, 60, 3, 1, 2, 3, 1, 1]);
  });

  it("per-grade columns appear only for grades that have teachers", () => {
    const cols = shape("overall").exportList!.columns.join("|");
    expect(cols).toContain("Grade 2 ARAL teachers");
    expect(cols).toContain("Grade 3 ARAL teachers");
    expect(cols).not.toContain("Grade 5");
    expect(cols).not.toContain("Grade 6");
  });
});

describe("ARAL teachers report table", () => {
  it("replaces the Category/Count blocks with the one-row-per-school block, Total row bold", () => {
    const table = SUMMARY_FACETS["aral-teachers"].toReportTable(shape("school"), FRAME);
    // Overall + PDF per-grade totals + three Excel per-grade sheets.
    expect(table.blocks).toHaveLength(5);
    const block = table.blocks![0]!;
    expect(block.sheetName).toBe("Overall");
    expect(block.columns.map((c) => c.header)).not.toContain("Category");
    expect(block.rows).toHaveLength(4);
    expect(block.boldRowIndices).toEqual([3]);
  });

  it("district level bolds the last (Total) row too", () => {
    const block = SUMMARY_FACETS["aral-teachers"].toReportTable(shape("district"), FRAME).blocks![0]!;
    expect(block.rows).toHaveLength(3);
    expect(block.boldRowIndices).toEqual([2]);
  });

  it("overall has no bold row", () => {
    const table = SUMMARY_FACETS["aral-teachers"].toReportTable(shape("overall"), FRAME);
    expect(table.blocks![0]!.boldRowIndices).toBeUndefined();
  });
});

describe("scopeRaw for aral-teachers", () => {
  it("drops another school's teacher and teacherGrade rows, and rows with no school", () => {
    const raw: RawAralRow[] = [
      ...RAW,
      { ...teacher("s9", NON, 7), school_id: "s9" },
      teacherGrade("s9", "G8", NON, 7),
      { ...teacherGrade("s1", "G9", NON, 1), school_id: null as unknown as string },
    ];
    const kept = scopeRaw("aral-teachers", raw, [S1]);
    expect(kept.every((r) => r.school_id === "s1")).toBe(true);
    expect(kept.some((r) => r.field === "teacher")).toBe(true);
    expect(kept.some((r) => r.field === "teacherGrade")).toBe(true);
    const r = shape("overall", raw, [S1]);
    const ids = section(r, "teachersByGrade").buckets.map((b) => b.id.split("|")[0]);
    expect(ids).not.toContain("G8");
    expect(ids).not.toContain("G9");
    expect(section(r, "teachers").table.groups[0]!.base).toBe(3);
  });
});
