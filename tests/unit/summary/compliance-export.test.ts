import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { filterComplianceResultForExport } from "@/lib/summary/shape/compliance";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Non-compliance export at school level: one row per flagged school with its
 * categories and a Remarks line per flag, instead of six Category/Count rows
 * per school. District and overall exports keep the old block.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { shapeCompliance } = await import("@/lib/summary/queries/compliance");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
type RawComplianceRow = import("@/lib/summary/queries/compliance").RawComplianceRow;

const TODAY = "2026-10-14";

function raw(id: string, extra: Partial<RawComplianceRow> = {}): RawComplianceRow {
  return {
    school_id: id,
    live: 10,
    non_archived: 10,
    pending: 0,
    grades_no_adviser: 0,
    aral: 5,
    incomplete: 0,
    enrollments: 10,
    drift: 0,
    last_attendance: "2026-10-13",
    reading: 5,
    last_week: 5,
    has_admin: true,
    mosy_not_updated: 0,
    mosy_for_decision: 0,
    sy_start: null,
    mosy_override_start: null,
    mosy_override_end: null,
    mosy_override_deadline: null,
    ...extra,
  };
}

function school(id: string, name: string, district: string | null): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: null, region: null, isActive: true };
}

const ALABEL = school("a", "Alabel Central", "Alabel 1");
const BETA = school("b", "Beta ES", "Alabel 1");
const OK = school("c", "Healthy ES", "Alabel 2");
const SCHOOLS = [BETA, OK, ALABEL];

const ROWS = [
  // No learners, a pending teacher, no recent attendance.
  raw("a", { live: 0, non_archived: 0, enrollments: 0, aral: 0, pending: 2, reading: 0, last_week: 0, last_attendance: null }),
  raw("b", { incomplete: 3 }),
  raw("c"),
];

const FRAME: ReportFrame = {
  schoolName: "Division",
  schoolIdCode: "",
  region: "",
  division: "",
  district: "",
  address: "",
  schoolYearLabel: "",
  schoolHeadName: "",
  preparedBy: "t",
};

function shape(level: "school" | "district" | "overall") {
  return shapeCompliance({
    raw: scopeRaw("compliance", ROWS, SCHOOLS),
    schools: SCHOOLS,
    level,
    todayKey: TODAY,
    computedAt: "x",
  });
}

const table = (result: ReturnType<typeof shape>) => SUMMARY_FACETS.compliance.toReportTable(result, FRAME);

describe("Non-compliance export at school level", () => {
  it("leads with one row per flagged school, sorted by district then name", () => {
    const first = table(shape("school")).blocks![0]!;
    expect(first.heading).toBe("Schools flagged");
    expect(first.columns.map((c) => c.header)).toEqual(["School", "School ID", "District", "Non-compliance", "Remarks"]);
    expect(first.wrap).toBe(true);
    expect(first.rows).toEqual([
      [
        "Alabel Central",
        "code-a",
        "Alabel 1",
        "No encoded data, Pending",
        "No encoded data: No learners encoded\nPending: 2 teachers awaiting approval",
      ],
      [
        "Beta ES",
        "code-b",
        "Alabel 1",
        "Incomplete",
        "Incomplete: 3 learners are missing nutritional status or English reading level",
      ],
    ]);
  });

  it("states how many schools have no flags, and drops the six-row Category block", () => {
    const t = table(shape("school"));
    expect(first(t).note).toContain("1 school has no flags");
    expect(t.blocks!.filter((b) => b.heading === "Schools flagged")).toHaveLength(1);
    expect(t.blocks!.some((b) => b.columns.some((c) => c.header === "Category"))).toBe(false);
  });

  it("keeps the per-flag sheets and the no-district-admin sheet after it", () => {
    const headings = table(shape("school")).blocks!.map((b) => b.heading);
    expect(headings).toEqual([
      "Schools flagged",
      "No encoded data",
      "Pending",
      "Not updated",
      "Incomplete",
      "Discrepancies",
      "Schools with no district admin",
    ]);
  });

  it("narrows to the schools carrying the chosen flag, still showing all their categories", () => {
    const filtered = filterComplianceResultForExport(shape("school"), "PENDING");
    const block = table(filtered).blocks![0]!;
    expect(block.heading).toBe("Schools flagged");
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0]![0]).toBe("Alabel Central");
    expect(block.rows[0]![3]).toBe("No encoded data, Pending");
  });

  it("is JSON-serializable for the data cache", () => {
    const result = shape("school");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("Non-compliance export above school level", () => {
  it.each(["district", "overall"] as const)("keeps the Category/Count block at %s level", (level) => {
    const result = shape(level);
    expect(result.exportList).toBeUndefined();
    const t = table(result);
    expect(t.blocks![0]!.columns.map((c) => c.header)).toContain("Category");
    expect(t.blocks![0]!.wrap).toBeUndefined();
  });
});

function first(t: ReturnType<typeof table>) {
  return t.blocks![0]!;
}
