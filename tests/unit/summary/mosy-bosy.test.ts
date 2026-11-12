import { describe, expect, it, vi } from "vitest";
import type { ReportFrame } from "@/lib/reports/report-frame";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool, SummaryLevel } from "@/lib/summary/types";

/**
 * Facets `bosy` and `mosy`: the Division Summary view of the teacher BOSY
 * Report and MOSY Report. The SQL groups by raw columns; the status, reason
 * group and BOSY tier are decided here, in pure TS, with the teacher pages' own
 * functions. Pure shaping; no Prisma.
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

const mod = await import("@/lib/summary/queries/mosy-bosy");
const { shapeMosy, shapeBosy, mosyStatusOfRow, mosyReasonGroup, queryMosyRows, queryBosyRows } = mod;
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
type RawMosyRow = import("@/lib/summary/queries/mosy-bosy").RawMosyRow;
type RawBosyRow = import("@/lib/summary/queries/mosy-bosy").RawBosyRow;

function school(id: string, name: string, district: string | null): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: "Sarangani", region: "XII", isActive: true };
}

const S1 = school("s1", "Alabel CES", "Alabel 1");
const S2 = school("s2", "Bagacay ES", "Alabel 1");
const S3 = school("s3", "Glan CES", "Glan 1");
const SCHOOLS = [S1, S2, S3];

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

const m = (
  id: string,
  gt: string,
  over: Partial<Omit<RawMosyRow, "school_id" | "gt">>
): RawMosyRow => ({
  school_id: id,
  gt,
  is_aral: true,
  has_row: false,
  decision: null,
  reason: null,
  count: 1,
  ...over,
});
const out = (id: string, gt: string, reason: string, count = 1) =>
  m(id, gt, { is_aral: false, has_row: true, decision: "MOVE_OUT", reason, count });

/**
 * s1 G2: 2 not updated, 1 level saved (no decision), 3 stay, 1 NLPA, 1 legacy improved.
 * s1 G3: 1 NLPA, 2 transferred out, 1 MOVE_OUT but tagged again (for decision).
 * s2 G2: 1 diagnosed LSEN, 1 recommended LSEN assessment. s3: nothing.
 */
const MOSY_RAW: RawMosyRow[] = [
  m("s1", "G2", { count: 2 }),
  m("s1", "G2", { has_row: true }),
  m("s1", "G2", { has_row: true, decision: "STAY", count: 3 }),
  out("s1", "G2", "NLPA"),
  out("s1", "G2", "IMPROVED_EARLY_GRADES"),
  out("s1", "G3", "NLPA"),
  out("s1", "G3", "TRANSFERRED_OUT", 2),
  m("s1", "G3", { has_row: true, decision: "MOVE_OUT", reason: "NLPA" }),
  out("s2", "G2", "DIAGNOSED_LSEN"),
  out("s2", "G2", "RECOMMENDED_LSEN_ASSESSMENT"),
];

const b = (id: string, gt: string, filipino: string, count = 1): RawBosyRow => ({ school_id: id, gt, filipino, count });

/** s1: G2 2 Level 0 (Low), 1 Level 2 (Developing); G3 1 High Emergent, 1 Transitioning. s2: G4 1 Grade Ready. */
const BOSY_RAW: RawBosyRow[] = [
  b("s1", "G2", "CANNOT_NAME_SOUND_LETTERS", 2),
  b("s1", "G2", "CV_BLENDING"),
  b("s1", "G3", "FRUSTRATION_HIGH_EMERGENT"),
  b("s1", "G3", "TRANSITIONING"),
  b("s2", "G4", "INDEPENDENT_GRADE_READY"),
];

function mosy(level: SummaryLevel, schools = SCHOOLS) {
  return shapeMosy({ raw: scopeRaw("mosy", MOSY_RAW, schools), schools, level, computedAt: "T" });
}
function bosy(level: SummaryLevel, schools = SCHOOLS) {
  return shapeBosy({ raw: scopeRaw("bosy", BOSY_RAW, schools), schools, level, computedAt: "T" });
}

describe("mosyStatusOfRow (the teacher page's mosyRowStatus)", () => {
  it("no decision row is not updated", () => {
    expect(mosyStatusOfRow({ is_aral: true, has_row: false, decision: null })).toBe("not_updated");
  });
  it("a saved level with no decision is for decision", () => {
    expect(mosyStatusOfRow({ is_aral: true, has_row: true, decision: null })).toBe("for_decision");
  });
  it("STAY is stay", () => {
    expect(mosyStatusOfRow({ is_aral: true, has_row: true, decision: "STAY" })).toBe("stay");
  });
  it("MOVE_OUT on an untagged learner is moved out", () => {
    expect(mosyStatusOfRow({ is_aral: false, has_row: true, decision: "MOVE_OUT" })).toBe("moved_out");
  });
  it("MOVE_OUT on a learner tagged again is for decision", () => {
    expect(mosyStatusOfRow({ is_aral: true, has_row: true, decision: "MOVE_OUT" })).toBe("for_decision");
  });
});

describe("mosyReasonGroup", () => {
  it("folds both legacy improved reasons into Improved reading level", () => {
    expect(mosyReasonGroup("IMPROVED_EARLY_GRADES")).toBe("IMPROVED_READING_LEVEL");
    expect(mosyReasonGroup("IMPROVED_UPPER_GRADES")).toBe("IMPROVED_READING_LEVEL");
    expect(mosyReasonGroup("IMPROVED_READING_LEVEL")).toBe("IMPROVED_READING_LEVEL");
  });
  it("keeps NLPA, transferred out and the LSEN reasons apart", () => {
    for (const r of ["NLPA", "TRANSFERRED_OUT", "DIAGNOSED_LSEN", "RECOMMENDED_LSEN_ASSESSMENT"]) {
      expect(mosyReasonGroup(r)).toBe(r);
    }
  });
  it("returns null for an unknown reason", () => {
    expect(mosyReasonGroup("SOMETHING_NEW")).toBeNull();
    expect(mosyReasonGroup(null)).toBeNull();
  });
});

describe("shapeMosy", () => {
  it("overall: statuses are disjoint and add up to every MOSY learner", () => {
    const res = mosy("overall");
    const status = res.sections.find((s) => s.id === "status")!;
    const all = status.table.groups.find((g) => g.key === "overall")!;
    // 14 learners: 8 in s1 Grade 2, 4 in s1 Grade 3, 2 in s2
    expect(all.base).toBe(14);
    expect(all.cells.not_updated!.count).toBe(2);
    expect(all.cells.for_decision!.count).toBe(2);
    expect(all.cells.stay!.count).toBe(3);
    expect(all.cells.moved_out!.count).toBe(7);
  });

  it("overall: moved out by reason, NLPA counted, the re-tagged learner not", () => {
    const res = mosy("overall");
    const reasons = res.sections.find((s) => s.id === "movedOutByReason")!;
    const all = reasons.table.groups.find((g) => g.key === "overall")!;
    expect(all.base).toBe(7);
    expect(all.cells.NLPA!.count).toBe(2);
    expect(all.cells.TRANSFERRED_OUT!.count).toBe(2);
    expect(all.cells.IMPROVED_READING_LEVEL!.count).toBe(1);
    expect(all.cells.DIAGNOSED_LSEN!.count).toBe(1);
    expect(all.cells.RECOMMENDED_LSEN_ASSESSMENT!.count).toBe(1);
  });

  it("splits by grade at overall level", () => {
    const status = mosy("overall").sections.find((s) => s.id === "status")!;
    expect(status.byGrade).toBe(true);
    const g3 = status.table.groups.find((g) => g.gradeType === "G3")!;
    expect(g3.base).toBe(4);
    expect(g3.cells.moved_out!.count).toBe(3);
  });

  it("export: one row per school, counts first, per-grade columns, Total row", () => {
    const res = mosy("school");
    const list = res.exportList!;
    expect(list.columns.slice(0, 9)).toEqual([
      "School",
      "School ID",
      "District",
      "MOSY learners",
      "Not updated",
      "Level saved, no decision yet",
      "Stay in ARAL",
      "Moved out",
      "Moved out: Improved reading level",
    ]);
    expect(list.columns).toContain("Moved out: NLPA");
    expect(list.columns.slice(-6)).toEqual([
      "Grade 2 learners",
      "Grade 2 stay",
      "Grade 2 moved out",
      "Grade 3 learners",
      "Grade 3 stay",
      "Grade 3 moved out",
    ]);
    expect(list.rows).toHaveLength(4); // 3 schools + Total
    const [s1, s2, s3, total] = list.rows;
    // s1: 12 learners; 2 not updated, 2 for decision, 3 stay, 5 out; reasons I=1 LSEN 0 0 T=2 NLPA=2; G2 8/3/2; G3 4/0/3
    expect(s1).toEqual(["Alabel CES", "code-s1", "Alabel 1", 12, 2, 2, 3, 5, 1, 0, 0, 2, 2, 8, 3, 2, 4, 0, 3]);
    expect(s2).toEqual(["Bagacay ES", "code-s2", "Alabel 1", 2, 0, 0, 0, 2, 0, 1, 1, 0, 0, 2, 0, 2, 0, 0, 0]);
    expect(s3!.slice(3).every((n) => n === 0)).toBe(true);
    expect(total!.slice(0, 4)).toEqual(["Total", "", "", 14]);
    expect(list.groups).toEqual([
      { label: "Grade 2", start: 13, count: 3 },
      { label: "Grade 3", start: 16, count: 3 },
    ]);
  });

  it("district export rows are the sums of their schools'", () => {
    const list = mosy("district").exportList!;
    expect(list.columns[0]).toBe("District");
    const alabel = list.rows.find((r) => r[0] === "Alabel 1")!;
    expect(alabel[1]).toBe(14);
    const glan = list.rows.find((r) => r[0] === "Glan 1")!;
    expect(glan[1]).toBe(0);
  });

  it("a district scope never shows another district's school", () => {
    const res = mosy("school", [S3]);
    expect(JSON.stringify(res)).not.toContain("Alabel CES");
    expect(res.exportList!.rows).toHaveLength(1);
  });

  it("toReportTable prints the export list as the only block", () => {
    const res = mosy("school");
    const table = SUMMARY_FACETS.mosy.toReportTable(res, FRAME);
    expect(table.blocks).toHaveLength(1);
    expect(table.blocks![0]!.rows).toBe(res.exportList!.rows);
    expect(table.blocks![0]!.boldRowIndices).toEqual([3]);
  });
});

describe("shapeBosy", () => {
  it("groups by the Filipino BOSY tier, the K-2 letter rubric folded in", () => {
    const section = bosy("overall").sections[0]!;
    const all = section.table.groups.find((g) => g.key === "overall")!;
    expect(all.base).toBe(6);
    expect(all.cells.tier1!.count).toBe(2);
    expect(all.cells.tier2!.count).toBe(1);
    expect(all.cells.tier3!.count).toBe(2);
    expect(all.cells.tier4!.count).toBe(1);
    expect(section.buckets.map((x) => x.label)).toEqual(["Low Emergent", "High Emergent", "Developing", "Grade Ready"]);
  });

  it("lists an unknown level under Other level instead of dropping it", () => {
    const raw = [...BOSY_RAW, b("s1", "G2", "MADE_UP")];
    const res = shapeBosy({ raw: scopeRaw("bosy", raw, SCHOOLS), schools: SCHOOLS, level: "overall", computedAt: "T" });
    const section = res.sections[0]!;
    expect(section.buckets.at(-1)!.label).toBe("Other level");
    expect(section.table.groups.find((g) => g.key === "overall")!.base).toBe(7);
  });

  it("export: one row per school, counts first, then per grade learners and the four groups", () => {
    const list = bosy("school").exportList!;
    expect(list.columns.slice(0, 8)).toEqual([
      "School",
      "School ID",
      "District",
      "ARAL learners",
      "Low Emergent",
      "High Emergent",
      "Developing",
      "Grade Ready",
    ]);
    expect(list.columns.slice(8, 13)).toEqual([
      "Grade 2 learners",
      "Grade 2 Low Emergent",
      "Grade 2 High Emergent",
      "Grade 2 Developing",
      "Grade 2 Grade Ready",
    ]);
    const s1 = list.rows[0]!;
    expect(s1.slice(3)).toEqual([5, 2, 1, 2, 0, 3, 2, 0, 1, 0, 2, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect(list.rows.at(-1)!.slice(0, 4)).toEqual(["Total", "", "", 6]);
  });

  it("overall export is a single row", () => {
    const list = bosy("overall").exportList!;
    expect(list.columns[0]).toBe("Scope");
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]![1]).toBe(6);
  });
});

describe("SQL", () => {
  it("MOSY reads the same population as the teacher pages, with no school filter", async () => {
    await queryMosyRows();
    const text = lastQuery!.text;
    expect(text).toContain(`"isActive" = true`);
    expect(text).toContain(`l."archivedAt" IS NULL`);
    expect(text).toContain(`l."isAralLearner" = true OR d."decision" = 'MOVE_OUT'`);
    expect(text).not.toMatch(/"schoolId"\s*=\s*\$/);
  });
  it("BOSY groups by the Filipino reading profile", async () => {
    await queryBosyRows();
    expect(lastQuery!.text).toContain(`"filipinoReadingProfile"`);
  });
});

describe("PDF and Excel export", () => {
  it.each(["mosy", "bosy"] as const)("%s renders to a PDF and to an Excel sheet with every export column", async (facet) => {
    const ExcelJS = (await import("exceljs")).default;
    const { renderExcel, renderPdf } = await import("@/lib/reports/render");
    const res = facet === "mosy" ? mosy("school") : bosy("school");
    const table = SUMMARY_FACETS[facet].toReportTable(res, FRAME);

    const pdf = await renderPdf(table);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(table)) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const cells: unknown[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => cells.push(c.value)));
    for (const header of res.exportList!.columns) expect(cells).toContain(header);
    expect(cells).toContain("Alabel CES");
  });
});
