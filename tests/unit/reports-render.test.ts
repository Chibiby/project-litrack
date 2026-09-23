import { describe, expect, it, vi } from "vitest";
import type { CellValue, Workbook, Worksheet } from "exceljs";
import type { ReportTable } from "@/lib/reports/render";

type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

/**
 * The two renderers, actually run.
 *
 * PDF shipped broken: it rendered fine under plain Node but every attempt in
 * production returned "Could not generate the report", because `pdfkit` reads
 * font metrics and an ICC profile from files inside its own package and Next
 * had bundled it, destroying those paths. Excel kept working throughout, which
 * is exactly why nothing caught it — the tests asserted tenancy, history and
 * date binding, and never once produced a file.
 *
 * These tests produce real bytes and check the magic number. They cannot catch
 * a bundling regression on their own (they run outside Next), so the fix lives
 * in `serverExternalPackages` in next.config.mjs — but they do catch every way
 * the drawing code itself can throw, which is the other half of that failure.
 */

// `server-only` throws when imported outside a React Server Component, and this
// module is imported directly here.
vi.mock("server-only", () => ({}));

const { renderExcel, renderPdf, renderReport, reportBlocks } = await import(
  "@/lib/reports/render"
);

const FRAME = {
  schoolName: "Malandag Central Elem.",
  schoolIdCode: "130517",
  region: "XII",
  division: "Sarangani",
  district: "Malungon West",
  address: "Malandag, Malungon",
  schoolYearLabel: "2026-2027",
  schoolHeadName: "Lourdes Santos",
  preparedBy: "Marivic M Acibar",
};

const TABLE: ReportTable = {
  title: "Attendance Records",
  summary: ["3 record(s)"],
  reportingPeriod: "2026-08-24 to 2026-08-28",
  frame: FRAME,
  columns: [
    { header: "Date", width: 12 },
    { header: "Learner", width: 28 },
    { header: "Status", width: 12 },
    { header: "Reason / Remarks", width: 30 },
  ],
  rows: [
    ["2026-08-25", "Asriel Gabby B. Andrews", "Absent", "Sick / Illness"],
    ["2026-08-26", "Blair Christian Oirada", "Present", ""],
    ["2026-08-27", "BRANDNLEE S HGOS", "Excused", null],
  ],
};

async function load(buf: Buffer): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelLoadable);
  return wb;
}

/** The row whose first cell is `text`, or -1. */
function rowStarting(ws: Worksheet, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(1).value ?? "") === text) return r;
  }
  return -1;
}

describe("renderPdf", () => {
  it("produces a real PDF", async () => {
    const buf = await renderPdf(TABLE);

    // %PDF- is the format's magic number; anything else is not a PDF however
    // many bytes came back.
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("survives a report with no rows", async () => {
    // The empty case draws an italic note instead of a table body, and takes a
    // different path through the row loop. A report with no matches is the
    // most likely thing a teacher generates by accident.
    const buf = await renderPdf({ ...TABLE, rows: [] });

    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("paginates a 400-row table without throwing, numbering every page", async () => {
    // The page break is decided BEFORE a row is drawn; getting that backwards
    // clips the last row of every page into the margin.
    const rows = Array.from({ length: 400 }, (_, i) => [
      "2026-08-25",
      `Learner ${i}`,
      "Present",
      "",
    ]);

    const buf = await renderPdf({ ...TABLE, rows });

    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
    // pdfkit writes one /Type /Page object per page; a 400-row list is many.
    const pages = buf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(5);
  });

  it("renders portrait for a narrow table and landscape for a wide one", async () => {
    const mediaBox = (buf: Buffer) =>
      /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(buf.toString("latin1"))!.slice(1).map(Number);

    const [pw, ph] = mediaBox(await renderPdf(TABLE));
    expect(pw).toBeLessThan(ph);

    const wide: ReportTable = {
      ...TABLE,
      columns: Array.from({ length: 9 }, (_, i) => ({ header: `C${i}`, width: 10 })),
      rows: [Array.from({ length: 9 }, (_, i) => i)],
    };
    const [lw, lh] = mediaBox(await renderPdf(wide));
    expect(lw).toBeGreaterThan(lh);
  });

  it("handles a null cell without printing 'null'", async () => {
    const buf = await renderPdf({
      ...TABLE,
      rows: [["2026-08-25", "Learner", "Excused", null]],
    });

    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("embeds the seal and the three bottom logos", async () => {
    const buf = await renderPdf(TABLE);
    const images = buf.toString("latin1").match(/\/Subtype \/Image/g) ?? [];
    // Each PNG with an alpha channel adds an SMask image too, so at least four.
    expect(images.length).toBeGreaterThanOrEqual(4);
  });
});

describe("renderExcel", () => {
  it("produces a real xlsx", async () => {
    const buf = await renderExcel(TABLE);

    // xlsx is a zip: PK\x03\x04.
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("does not choke on a title Excel would refuse as a sheet name", async () => {
    // Excel rejects : \ / ? * [ ] and anything over 31 chars. The report title
    // is a human string, so it can legitimately contain them.
    const buf = await renderExcel({
      ...TABLE,
      title: "End of Term Report (Grades) / First Term: Grade 5 [Section A]",
    });

    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("defaults to the PRINT template: seal + 3 logos, uppercase title, navy table header", async () => {
    const wb = await load(await renderExcel(TABLE));
    const ws = wb.worksheets[0]!;

    expect(ws.getImages()).toHaveLength(4);
    expect(rowStarting(ws, "ATTENDANCE RECORDS")).toBeGreaterThan(1);
    const header = rowStarting(ws, "Date");
    expect(ws.getRow(header).getCell(1).fill).toMatchObject({ fgColor: { argb: "FF17365D" } });
    expect(ws.getRow(header + 1).getCell(2).value).toBe("Asriel Gabby B. Andrews");
    expect(rowStarting(ws, "3 record(s)")).toBeGreaterThan(header + 3);
    expect(rowStarting(ws, "Reporting Period: 2026-08-24 to 2026-08-28")).toBe(-1); // right half, not col A
    expect(ws.pageSetup.paperSize).toBe(9);
  });

  it("draws a plain RECORDS sheet when asked", async () => {
    const wb = await load(await renderExcel(TABLE, { purpose: "RECORDS" }));
    const ws = wb.worksheets[0]!;

    expect(ws.getImages()).toHaveLength(0);
    expect(((ws.model as { merges?: string[] }).merges ?? []).length).toBe(0);
    expect(ws.getRow(3).getCell(1).value).toBe("Date");
    expect(ws.autoFilter).toBe("A3:D6");
  });
});

describe("renderReport", () => {
  it("routes each format to its own renderer", async () => {
    const pdf = await renderReport(TABLE, "PDF");
    const excel = await renderReport(TABLE, "EXCEL");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(excel.subarray(0, 2).toString()).toBe("PK");
  });

  it("gives a PDF the print template even when RECORDS is asked for", async () => {
    const pdf = await renderReport(TABLE, "PDF", { purpose: "RECORDS" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

/**
 * MOSY is the first report with more than one table. Its top-level
 * `columns`/`rows` are deliberately wrong ("IGNORED …") so a renderer that
 * still reads them instead of going through `reportBlocks` fails loudly
 * instead of silently passing.
 */
const MULTI_TABLE: ReportTable = {
  title: "Combined Report",
  summary: [],
  frame: FRAME,
  columns: [{ header: "IGNORED_COL" }],
  rows: [["ignored"]],
  blocks: [
    {
      heading: "Summary",
      columns: [
        { header: "Grade", width: 10 },
        { header: "Count", width: 10 },
      ],
      rows: [
        ["1", 10],
        ["2", 20],
      ],
    },
    {
      heading: "Details",
      columns: [
        { header: "Name", width: 20 },
        { header: "Status", width: 10 },
      ],
      rows: [],
    },
  ],
};

describe("reportBlocks", () => {
  it("falls back to the table's own columns/rows when blocks is absent", () => {
    expect(reportBlocks(TABLE)).toEqual([{ columns: TABLE.columns, rows: TABLE.rows }]);
  });

  it("returns table.blocks when set, ignoring the table's own columns/rows", () => {
    expect(reportBlocks(MULTI_TABLE)).toBe(MULTI_TABLE.blocks);
  });

  it("falls back when blocks is an empty array, so Excel still gets a sheet", async () => {
    const empty = { ...TABLE, rows: [], blocks: [] };
    expect(reportBlocks(empty)).toEqual([{ columns: TABLE.columns, rows: [] }]);
    const wb = await load(await renderExcel(empty));
    expect(wb.worksheets.length).toBe(1);
  });
});

describe("multi-block reports", () => {
  it("renders one Excel worksheet per block, named from each block's heading", async () => {
    const wb = await load(await renderExcel(MULTI_TABLE));
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Summary", "Details"]);
  });

  it("gives EVERY sheet the full template, sharing four embedded images", async () => {
    const wb = await load(await renderExcel(MULTI_TABLE));

    for (const ws of wb.worksheets) {
      expect(ws.getImages()).toHaveLength(4);
      expect(rowStarting(ws, "Prepared by:")).toBeGreaterThan(0);
      expect(rowStarting(ws, "DEPARTMENT OF EDUCATION")).toBe(3);
    }
    expect(rowStarting(wb.getWorksheet("Summary")!, "COMBINED REPORT — SUMMARY")).toBeGreaterThan(0);
    expect(wb.model.media.length).toBe(4);
  });

  it("ignores the table's own columns/rows once blocks is set", async () => {
    const wb = await load(await renderExcel(MULTI_TABLE, { purpose: "RECORDS" }));

    const summary = wb.getWorksheet("Summary")!;
    const headerValues = summary.getRow(3).values as CellValue[];
    expect(headerValues.slice(1)).toEqual(["Grade", "Count"]);
    // Line, blank, header + 2 data rows — never the ignored top-level row.
    expect(summary.rowCount).toBe(5);

    const details = wb.getWorksheet("Details")!;
    expect((details.getRow(3).values as CellValue[]).slice(1)).toEqual(["Name", "Status"]);
    expect(details.rowCount).toBe(3);
  });

  it("produces a PDF that starts with the PDF magic number and still draws the non-empty block", async () => {
    const buf = await renderPdf(MULTI_TABLE);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");

    // If the empty-state branch swallowed the sibling block's rows too, this
    // document would come out the same size as one where every block is
    // empty — comparing the two catches that regression without depending on
    // pdfkit's (compressed) internal stream layout.
    const allEmpty: ReportTable = {
      ...MULTI_TABLE,
      blocks: MULTI_TABLE.blocks!.map((b) => ({ ...b, rows: [] })),
    };
    const emptyBuf = await renderPdf(allEmpty);

    expect(emptyBuf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(emptyBuf.length);
  });
});
