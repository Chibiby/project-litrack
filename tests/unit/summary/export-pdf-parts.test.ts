import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";
import type { ReportFrame } from "@/lib/reports/report-frame";
import type { ReportBlock, ReportTable } from "@/lib/reports/render";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Wide Division Summary export lists print in PDF as readable parts
 * (`ReportBlock.pdfParts`), never as one 40+ column table with squeezed headers.
 * Excel must ignore the hint entirely.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// A recording pdfkit: the real class, plus a log of every text() call and the
// font that was active when it was drawn.
type TextCall = { text: string; font: string };
const drawn: TextCall[] = [];
vi.mock("pdfkit", async (importOriginal) => {
  const mod = await importOriginal<{ default: new (...a: unknown[]) => Record<string, unknown> }>();
  const Base = mod.default as unknown as new (...a: unknown[]) => {
    font(...a: unknown[]): unknown;
    text(...a: unknown[]): unknown;
  };
  class Spy extends Base {
    private currentFont = "Helvetica";
    font(...a: unknown[]) {
      if (typeof a[0] === "string") this.currentFont = a[0];
      return super.font(...a);
    }
    text(...a: unknown[]) {
      drawn.push({ text: String(a[0]), font: this.currentFont });
      return super.text(...a);
    }
  }
  return { ...mod, default: Spy };
});

const { exportListReportTable } = await import("@/lib/summary/export");
const { shapeAral, shapeAralTeachers, shapeAdvisory } = await import("@/lib/summary/queries/aral");
const { renderExcel, renderPdf } = await import("@/lib/reports/render");
type RawAralRow = import("@/lib/summary/queries/aral").RawAralRow;
type RawAdvisoryRow = import("@/lib/summary/queries/aral").RawAdvisoryRow;
type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

const MAX_PART = 14;
const ALL_GRADES = ["KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"];

function school(id: string, name: string, district: string): ScopeSchool {
  return { id, name, schoolIdCode: `code-${id}`, district, division: "Sarangani", region: "XII", isActive: true };
}
const SCHOOLS = [school("s1", "Alabel CES", "Alabel 1"), school("s2", "Bagacay ES", "Alabel 1")];

const FRAME: ReportFrame = {
  schoolName: "Division-wide (2 schools)",
  schoolIdCode: "",
  region: "XII",
  division: "Sarangani",
  district: "",
  address: "",
  schoolYearLabel: "",
  schoolHeadName: "",
  preparedBy: "Admin",
};

function teacherRaw(grades: string[]): RawAralRow[] {
  const rows: RawAralRow[] = [];
  for (const id of ["s1", "s2"]) {
    rows.push({ school_id: id, field: "teacher", bucket: null, employment_type: "DEPED_PLANTILLA", designation: null, count: 2 });
    rows.push({ school_id: id, field: "teacher", bucket: null, employment_type: "NON_DEPED", designation: null, count: 1 });
    for (const g of grades) {
      rows.push({ school_id: id, field: "teacherGrade", bucket: g, employment_type: "DEPED_PLANTILLA", designation: null, count: 2 });
      rows.push({ school_id: id, field: "teacherGrade", bucket: g, employment_type: "NON_DEPED", designation: null, count: 1 });
    }
  }
  return rows;
}
function learnerRaw(grades: string[]): RawAralRow[] {
  return ["s1", "s2"].flatMap((id) =>
    grades.map((g): RawAralRow => ({ school_id: id, field: "grade", bucket: g, employment_type: null, designation: null, count: 5 }))
  );
}
function advisoryRaw(grades: string[]): RawAdvisoryRow[] {
  return ["s1", "s2"].flatMap((id) => [
    { school_id: id, field: "adviser", bucket: "DEFAULT", count: 3 } as RawAdvisoryRow,
    ...grades.map((g): RawAdvisoryRow => ({ school_id: id, field: "adviserGrade", bucket: g, count: 2 })),
  ]);
}

const computedAt = "2026-11-01T00:00:00.000Z";
const teachers = (grades: string[]) =>
  shapeAralTeachers({ raw: scopeRaw("aral-teachers", teacherRaw(grades), SCHOOLS), schools: SCHOOLS, level: "school", computedAt });
const learnersResult = (grades: string[]) =>
  shapeAral({ raw: scopeRaw("aral", learnerRaw(grades), SCHOOLS), schools: SCHOOLS, level: "school", computedAt });
const advisory = (grades: string[]) =>
  shapeAdvisory({ raw: scopeRaw("advisory", advisoryRaw(grades), SCHOOLS), schools: SCHOOLS, level: "school", computedAt });

function blockOf(result: ReturnType<typeof teachers>): ReportBlock {
  return exportListReportTable(result, FRAME).blocks![0]!;
}

/** Whole-grade-group invariants on a split export, given the list's own groups. */
function expectWellFormedParts(result: ReturnType<typeof teachers>) {
  const block = blockOf(result);
  const list = result.exportList!;
  const parts = block.pdfParts!;
  expect(parts).toBeDefined();
  const groups = list.groups!;
  const firstGrade = Math.min(...groups.map((g) => g.start));

  // First part: every lead + overall column, in order.
  expect(parts[0]!.heading).toBe("Overall");
  expect(parts[0]!.columns).toEqual(Array.from({ length: firstGrade }, (_, i) => i));

  const covered: number[] = [];
  for (const part of parts.slice(1)) {
    expect(part.columns[0]).toBe(0);
    expect(part.columns.length).toBeLessThanOrEqual(MAX_PART);
    const rest = part.columns.slice(1);
    covered.push(...rest);
    // Whole groups only: every group is entirely in this part or entirely out.
    for (const g of groups) {
      const cols = Array.from({ length: g.count }, (_, i) => g.start + i);
      const inPart = cols.filter((c) => rest.includes(c)).length;
      expect([0, g.count]).toContain(inPart);
    }
  }
  for (const part of parts) expect(part.columns.length).toBeLessThanOrEqual(MAX_PART);

  // Every grade column exactly once, in order.
  const expected = Array.from({ length: list.columns.length - firstGrade }, (_, i) => firstGrade + i);
  expect(covered).toEqual(expected);
  expect(parts.length).toBeGreaterThanOrEqual(2);
}

describe("exportListReportTable pdfParts", () => {
  it("ARAL teachers: PDF shows one total per grade, Excel gets four sheets", () => {
    const result = teachers(ALL_GRADES);
    const list = result.exportList!;
    const blocks = exportListReportTable(result, FRAME).blocks!;
    const pdf = blocks.filter((b) => !b.formats || b.formats.includes("pdf"));
    const excel = blocks.filter((b) => !b.formats || b.formats.includes("excel"));

    // Excel: Overall, Total per grade level, DepEd, Non-DepEd.
    expect(excel.map((b) => b.sheetName)).toEqual(["Overall", "Total per grade level", "DepEd", "Non-DepEd"]);
    const groups = list.groups!;
    const firstGrade = Math.min(...groups.map((g) => g.start));
    expect(excel[0]!.columns.map((c) => c.header)).toEqual(list.columns.slice(0, firstGrade));
    const g3 = groups.find((g) => g.label === "Grade 3")!;
    for (const [i, offset] of [[1, 0], [2, 1], [3, 2]] as const) {
      const sheet = excel[i]!;
      expect(sheet.columns.map((c) => c.header)).toEqual([
        ...list.columns.slice(0, 3),
        ...groups.map((g) => g.label),
      ]);
      const col = sheet.columns.findIndex((c) => c.header === "Grade 3");
      expect(sheet.rows.map((r) => r[col])).toEqual(list.rows.map((r) => r[g3.start + offset]));
    }

    // PDF: Overall, then the per-grade totals only — no DepEd / Non-DepEd split.
    expect(pdf).toHaveLength(2);
    const grades = pdf[1]!;
    const headers = grades.columns.map((c) => c.header);
    expect(headers).toEqual([list.columns[0], ...groups.map((g) => g.label)]);
    expect(headers.some((h) => /DepEd/.test(h))).toBe(false);
    // Name + 13 grades fits one A4 table; wider lists split into parts.
    expect(grades.columns.length).toBeLessThanOrEqual(MAX_PART);
    expect(grades.pdfParts).toBeUndefined();
  });

  it("ARAL learners (one count column per grade): same invariants", () => {
    const result = learnersResult(ALL_GRADES);
    expect(result.exportList!.columns.length).toBeGreaterThan(MAX_PART);
    expectWellFormedParts(result);
    const g = result.exportList!.groups!.find((x) => x.label === "Grade 1")!;
    expect(g.count).toBe(1);
    expect(result.exportList!.columns[g.start]).toBe("Grade 1");
    expect(result.exportList!.columns.some((c) => c.includes("%"))).toBe(false);
  });

  it("Advisory (one column per grade): same invariants", () => {
    const result = advisory(ALL_GRADES);
    expect(result.exportList!.columns.length).toBeGreaterThan(MAX_PART);
    expectWellFormedParts(result);
  });

  it("a narrow list (<= 14 columns) has no pdfParts", () => {
    for (const result of [advisory(["G2", "G3"]), learnersResult(["G2", "G3"]), teachers(["G2"])]) {
      expect(result.exportList!.columns.length).toBeLessThanOrEqual(MAX_PART);
      expect(blockOf(result).pdfParts).toBeUndefined();
    }
  });

  it("does not disturb the full column and row list the Excel export uses", () => {
    const result = learnersResult(ALL_GRADES);
    const block = blockOf(result);
    expect(block.columns.map((c) => c.header)).toEqual(result.exportList!.columns);
    expect(block.rows).toEqual(result.exportList!.rows);
  });
});

describe("renderPdf with pdfParts", () => {
  beforeAll(async () => {
    await renderPdf({ title: "warm", summary: [], frame: FRAME, columns: [{ header: "A" }], rows: [["x"]] });
  }, 30_000);
  beforeEach(() => {
    drawn.length = 0;
  });

  const tableFor = (result: ReturnType<typeof teachers>, block = blockOf(result)): ReportTable => ({
    title: "ARAL teachers",
    summary: [],
    frame: FRAME,
    columns: block.columns,
    rows: block.rows,
    blocks: [block],
  });

  it("draws every part's headers and a part heading, and prints longer than the unsplit table", async () => {
    const result = learnersResult(ALL_GRADES);
    const block = blockOf(result);
    const { pdfParts, ...plain } = block;
    expect(pdfParts).toBeDefined();

    const withParts = await renderPdf(tableFor(result, block));
    const textsWith = drawn.map((d) => d.text);
    drawn.length = 0;
    const without = await renderPdf(tableFor(result, plain));

    expect(withParts.subarray(0, 5).toString()).toBe("%PDF-");
    expect(withParts.length).not.toBe(without.length);

    // Every column header of the full list is drawn, and the lead header is
    // drawn once per part (at least; a page break redraws it).
    for (const c of block.columns) expect(textsWith).toContain(c.header);
    const lead = block.columns[0]!.header;
    expect(textsWith.filter((t) => t === lead).length).toBeGreaterThanOrEqual(pdfParts!.length);
    // The unsplit render draws the lead header fewer times than the split one.
    const textsWithout = drawn.map((d) => d.text);
    expect(textsWithout.filter((t) => t === lead).length).toBeLessThan(pdfParts!.length);
    // Part headings.
    for (const p of pdfParts!) expect(textsWith).toContain(p.heading);
  }, 30_000);

  it("without pdfParts the block is drawn as one table: every header once, no part headings", async () => {
    const result = teachers(ALL_GRADES);
    const { pdfParts, ...plain } = blockOf(result);
    void pdfParts;
    await renderPdf(tableFor(result, plain));
    const texts = drawn.map((d) => d.text);
    expect(texts).not.toContain("Overall");
    const lead = plain.columns[0]!.header;
    // One header row on one page; rows (not headers) hold school names.
    expect(texts.filter((t) => t === lead).length).toBeGreaterThanOrEqual(1);
    for (const c of plain.columns) expect(texts).toContain(c.header);
  }, 30_000);

  it("the Total row is bold in every part", async () => {
    const result = learnersResult(ALL_GRADES);
    const block = blockOf(result);
    expect(block.boldRowIndices).toEqual([block.rows.length - 1]);
    await renderPdf(tableFor(result, block));
    const totalCells = drawn.filter((d) => d.text === "Total");
    // The "Total" label of the last row opens each part.
    expect(totalCells.length).toBeGreaterThanOrEqual(block.pdfParts!.length);
    // (Header "Grade n ARAL teachers" never equals "Total", so these are row cells.)
    for (const c of totalCells) expect(c.font).toBe("Helvetica-Bold");
    // Ordinary school rows stay regular.
    const schoolRow = drawn.filter((d) => d.text === "Alabel CES");
    expect(schoolRow.length).toBeGreaterThanOrEqual(block.pdfParts!.length);
    for (const c of schoolRow) expect(c.font).toBe("Helvetica");
  }, 30_000);

  it("a note is printed once, after the last part", async () => {
    const result = advisory(ALL_GRADES);
    const block = blockOf(result);
    expect(block.note).toBeTruthy();
    await renderPdf(tableFor(result, block));
    const hits = drawn.filter((d) => d.text === block.note);
    expect(hits).toHaveLength(1);
  }, 30_000);
});

describe("renderExcel ignores pdfParts", () => {
  async function load(buf: Buffer): Promise<Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);
    return wb;
  }
  function dump(wb: Workbook) {
    return wb.worksheets.map((ws) => ({
      name: ws.name,
      rowCount: ws.rowCount,
      columnCount: ws.columnCount,
      rows: Array.from({ length: ws.rowCount }, (_, i) => ws.getRow(i + 1).values),
    }));
  }

  it("same single sheet, header row and rows with or without pdfParts", async () => {
    const result = learnersResult(ALL_GRADES);
    const block = blockOf(result);
    const { pdfParts, ...plain } = block;
    expect(pdfParts).toBeDefined();
    const mk = (b: ReportBlock): ReportTable => ({
      title: "ARAL teachers",
      summary: [],
      frame: FRAME,
      columns: b.columns,
      rows: b.rows,
      blocks: [b],
    });

    const a = await load(await renderExcel(mk(block)));
    const b = await load(await renderExcel(mk(plain)));

    expect(a.worksheets).toHaveLength(1);
    expect(b.worksheets).toHaveLength(1);
    expect(dump(a)).toEqual(dump(b));

    // The header row carries every column, none dropped by the PDF split.
    const ws = a.worksheets[0]!;
    const headerValues: unknown[] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const vals = (ws.getRow(r).values as unknown[]).slice(1);
      if (vals.includes(block.columns[0]!.header) && vals.includes(block.columns.at(-1)!.header)) {
        headerValues.push(...vals);
        break;
      }
    }
    expect(headerValues).toEqual(block.columns.map((c) => c.header));
  }, 60_000);
});
