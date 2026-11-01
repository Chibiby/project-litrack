import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Facet `advisory` (Advisory): teachers who advise a section, Advisory (DEFAULT)
 * vs Multi-advisory (MULTI_GRADE), overall and per grade level.
 *
 * Counting rule: the SQL emits one `adviser` row per (school, mode) counting
 * DISTINCT teachers and one `adviserGrade` row per (school, grade) counting
 * DISTINCT teachers, so a teacher with two sections in one grade counts once in
 * that grade, and a multi-advisory teacher with sections in two grades counts in
 * both grades but once in Total advisers. Pure shaping here; no Prisma.
 */

let lastQuery: { text: string; values: unknown[] } | null = null;

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/summary/queries/population", () => ({
  populationCte: vi.fn(),
  runSummaryQuery: vi.fn(async (q: { text: string; values: unknown[] }) => {
    lastQuery = q;
    return [];
  }),
}));

const { shapeAdvisory, queryAdvisoryRows } = await import("@/lib/summary/queries/aral");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
type RawAdvisoryRow = import("@/lib/summary/queries/aral").RawAdvisoryRow;

function school(id: string, name: string, district: string | null): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: "Sarangani", region: "XII", isActive: true };
}

const S1 = school("s1", "Alabel CES", "Alabel 1");
const S2 = school("s2", "Bagacay ES", "Alabel 1");
const S3 = school("s3", "Glan CES", "Glan 1");
const SCHOOLS = [S1, S2, S3];

const adviser = (id: string, mode: "DEFAULT" | "MULTI_GRADE", count: number): RawAdvisoryRow => ({
  school_id: id,
  field: "adviser",
  bucket: mode,
  count,
});
const adviserGrade = (id: string, grade: string, count: number): RawAdvisoryRow => ({
  school_id: id,
  field: "adviserGrade",
  bucket: grade,
  count,
});

/**
 * s1: A advises two sections, both Grade 2 (counts once in Grade 2); B advises
 *     Grade 3; M is multi-advisory with sections in Grade 2 AND Grade 3.
 *     => 2 Advisory + 1 Multi-advisory = 3 advisers; Grade 2 has 2 (A, M), Grade 3 has 2 (B, M).
 * s2: one Advisory teacher in Grade 2. s3: no advisers.
 */
const RAW: RawAdvisoryRow[] = [
  adviser("s1", "DEFAULT", 2),
  adviser("s1", "MULTI_GRADE", 1),
  adviserGrade("s1", "G2", 2),
  adviserGrade("s1", "G3", 2),
  adviser("s2", "DEFAULT", 1),
  adviserGrade("s2", "G2", 1),
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
  raw: RawAdvisoryRow[] = RAW,
  schools: ScopeSchool[] = SCHOOLS
) {
  return shapeAdvisory({
    raw: scopeRaw("advisory", raw, schools),
    schools,
    level,
    computedAt: "2026-11-01T00:00:00.000Z",
  });
}

const section = (r: ReturnType<typeof shape>, id: string) => r.sections.find((s) => s.id === id)!;
const overall = (r: ReturnType<typeof shape>, id: string) =>
  section(r, id).table.groups.find((g) => g.key === "overall")!;

describe("shapeAdvisory", () => {
  const result = shape("overall");

  it("returns the advisory facetId, title and an advisers + per-grade section", () => {
    expect(result.facetId).toBe("advisory");
    expect(result.title).toBe("Advisory");
    expect(result.sections.map((s) => s.id)).toEqual(["advisers", "advisersByGrade"]);
  });

  it("splits Advisory from Multi-advisory and never shows the stored MULTI_GRADE spelling", () => {
    const labels = section(result, "advisers").buckets.map((b) => b.label);
    expect(labels).toEqual(["Advisory", "Multi-advisory"]);
    const cells = overall(result, "advisers").cells;
    expect(cells.DEFAULT!.count).toBe(3);
    expect(cells.MULTI_GRADE!.count).toBe(1);
    expect(overall(result, "advisers").base).toBe(4);
    expect(JSON.stringify(labels)).not.toMatch(/MULTI_GRADE|multi-grade/i);
  });

  it("a teacher with two sections in the same grade counts once in that grade", () => {
    // s2 alone: one Advisory teacher, one grade row of 1.
    const r = shape("overall", RAW, [S2]);
    expect(overall(r, "advisersByGrade").cells.G2!.count).toBe(1);
    expect(overall(r, "advisers").base).toBe(1);
  });

  it("a multi-advisory teacher in two grades counts in both grades but once in Total advisers", () => {
    const raw = [adviser("s1", "MULTI_GRADE", 1), adviserGrade("s1", "G2", 1), adviserGrade("s1", "G3", 1)];
    const r = shape("overall", raw, [S1]);
    expect(overall(r, "advisersByGrade").cells.G2!.count).toBe(1);
    expect(overall(r, "advisersByGrade").cells.G3!.count).toBe(1);
    expect(overall(r, "advisers").base).toBe(1);
    expect(overall(r, "advisers").cells.MULTI_GRADE!.count).toBe(1);
  });

  it("grade counts can add up to more than the advisers (4 advisers, 2 + 3 grade counts)", () => {
    const grades = overall(result, "advisersByGrade").cells;
    expect(grades.G2!.count).toBe(3);
    expect(grades.G3!.count).toBe(2);
    expect(grades.G2!.count + grades.G3!.count).toBeGreaterThan(overall(result, "advisers").base);
  });

  it("only grades that have advisers get buckets, in enum order", () => {
    expect(section(result, "advisersByGrade").buckets.map((b) => b.id)).toEqual(["G2", "G3"]);
  });

  it("falls back to every grade when no adviser has a grade", () => {
    const r = shape("overall", []);
    expect(section(r, "advisersByGrade").buckets).toHaveLength(14);
    expect(section(r, "advisersByGrade").buckets[0]!.id).toBe("KINDER");
  });

  it("school level keeps one row per school with that school's own counts", () => {
    const r = shape("school");
    const byId = (id: string) => section(r, "advisersByGrade").table.groups.find((g) => g.schoolId === id)!;
    expect(byId("s1").cells.G2!.count).toBe(2);
    expect(byId("s1").cells.G3!.count).toBe(2);
    expect(byId("s2").cells.G2!.count).toBe(1);
    expect(byId("s2").cells.G3!.count).toBe(0);
    expect(byId("s3").cells.G2!.count).toBe(0);
  });

  it("never puts a name, email or contact number in the result", () => {
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(blob).not.toMatch(/"(firstName|lastName|fullName|contactNumber)"/);
  });
});

describe("Advisory export list", () => {
  it("at school level: Advisory, Multi-advisory, Total advisers, then per present grade, then a Total row", () => {
    const list = shape("school").exportList!;
    expect(list.id).toBe("advisory-per-school");
    expect(list.columns).toEqual([
      "School",
      "School ID",
      "District",
      "Advisory",
      "Multi-advisory",
      "Total advisers",
      "Grade 2 advisers",
      "Grade 3 advisers",
    ]);
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(list.rows).toHaveLength(4);
    expect(byName.get("Alabel CES")).toEqual(["Alabel CES", "code-s1", "Alabel 1", 2, 1, 3, 2, 2]);
    expect(byName.get("Bagacay ES")).toEqual(["Bagacay ES", "code-s2", "Alabel 1", 1, 0, 1, 1, 0]);
    expect(byName.get("Glan CES")).toEqual(["Glan CES", "code-s3", "Glan 1", 0, 0, 0, 0, 0]);
    // Total row sums the rows: 4 advisers but 3 + 2 grade counts (a multi-advisory teacher is in both grades).
    expect(list.rows.at(-1)).toEqual(["Total", "", "", 3, 1, 4, 3, 2]);
  });

  it("at district level: one row per district plus a Total row, no School ID column", () => {
    const list = shape("district").exportList!;
    expect(list.columns.slice(0, 2)).toEqual(["District", "Advisory"]);
    expect(list.columns).not.toContain("School ID");
    const byName = new Map(list.rows.map((r) => [r[0], r]));
    expect(byName.get("Alabel 1")).toEqual(["Alabel 1", 3, 1, 4, 3, 2]);
    expect(byName.get("Glan 1")).toEqual(["Glan 1", 0, 0, 0, 0, 0]);
    expect(list.rows.at(-1)).toEqual(["Total", 3, 1, 4, 3, 2]);
  });

  it("overall: a single Scope row and no Total row", () => {
    const list = shape("overall").exportList!;
    expect(list.columns[0]).toBe("Scope");
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.slice(1)).toEqual([3, 1, 4, 3, 2]);
  });

  it("per-grade columns appear only for grades that have advisers", () => {
    const cols = shape("overall").exportList!.columns.join("|");
    expect(cols).toContain("Grade 2 advisers");
    expect(cols).toContain("Grade 3 advisers");
    expect(cols).not.toContain("Grade 1 advisers");
    expect(cols).not.toContain("Grade 4");
  });
});

describe("Advisory report table", () => {
  it("one-row-per-school block with the Total row bold", () => {
    const table = SUMMARY_FACETS.advisory.toReportTable(shape("school"), FRAME);
    expect(table.blocks).toHaveLength(1);
    const block = table.blocks![0]!;
    expect(block.columns.map((c) => c.header)).not.toContain("Category");
    expect(block.rows).toHaveLength(4);
    expect(block.boldRowIndices).toEqual([3]);
  });

  it("district level bolds the last (Total) row too", () => {
    const block = SUMMARY_FACETS.advisory.toReportTable(shape("district"), FRAME).blocks![0]!;
    expect(block.rows).toHaveLength(3);
    expect(block.boldRowIndices).toEqual([2]);
  });

  it("overall has no bold row", () => {
    const table = SUMMARY_FACETS.advisory.toReportTable(shape("overall"), FRAME);
    expect(table.blocks![0]!.boldRowIndices).toBeUndefined();
  });
});

describe("scopeRaw for advisory", () => {
  it("drops another school's rows and rows with no school", () => {
    const raw: RawAdvisoryRow[] = [
      ...RAW,
      adviser("s9", "DEFAULT", 7),
      adviserGrade("s9", "G8", 7),
      { ...adviserGrade("s1", "G9", 1), school_id: null as unknown as string },
    ];
    const kept = scopeRaw("advisory", raw, [S1]);
    expect(kept.every((r) => r.school_id === "s1")).toBe(true);
    expect(kept.some((r) => r.field === "adviser")).toBe(true);
    expect(kept.some((r) => r.field === "adviserGrade")).toBe(true);
    const r = shape("overall", raw, [S1]);
    const ids = section(r, "advisersByGrade").buckets.map((b) => b.id);
    expect(ids).not.toContain("G8");
    expect(ids).not.toContain("G9");
    expect(overall(r, "advisers").base).toBe(3);
  });
});

describe("queryAdvisoryRows SQL (no database in tests: string-level checks)", () => {
  async function sqlOf() {
    lastQuery = null;
    await queryAdvisoryRows();
    expect(lastQuery).not.toBeNull();
    return lastQuery!;
  }

  it("excludes the Non-DepEd ARAL Volunteer designation (stored value, as a bound parameter)", async () => {
    const q = await sqlOf();
    expect(q.text).toMatch(/"designation"\s+IS DISTINCT FROM\s+\$\d/);
    expect(q.values).toContain("Non-DepEd ARAL Volunteer");
  });

  it("excludes FLOATING advisers and treats a missing mode as DEFAULT", async () => {
    const q = await sqlOf();
    expect(q.text).toMatch(/<>\s*'FLOATING'/);
    expect(q.text).toContain(`COALESCE(tp."advisoryMode"::text, 'DEFAULT')`);
  });

  it("counts each teacher once per grade and once per mode (DISTINCT teachers)", async () => {
    const q = await sqlOf();
    expect(q.text).toContain("SELECT DISTINCT");
    expect((q.text.match(/COUNT\(DISTINCT teacher_id\)/g) ?? []).length).toBe(2);
  });

  it("only counts active, approved, non-deleted teachers in their own school, on live sections", async () => {
    const q = await sqlOf();
    expect(q.text).toContain(`s."deletedAt" IS NULL`);
    expect(q.text).toContain(`u."deletedAt" IS NULL`);
    expect(q.text).toContain(`u."isActive" = true`);
    expect(q.text).toContain(`u."approvalStatus" = 'APPROVED'`);
    expect(q.text).toContain(`u."schoolId" = s."schoolId"`);
  });
});
