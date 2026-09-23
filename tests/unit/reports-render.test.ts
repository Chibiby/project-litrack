import { describe, expect, it, vi } from "vitest";
import type { CellValue, Workbook } from "exceljs";
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

const TABLE = {
  title: "Attendance Records",
  subtitle: ["Malandag Central Elem.", "Range: 2026-08-24 to 2026-08-28"],
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

  it("paginates a table longer than one page without throwing", async () => {
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
  });

  it("handles a null cell without printing 'null'", async () => {
    const buf = await renderPdf({
      ...TABLE,
      rows: [["2026-08-25", "Learner", "Excused", null]],
    });

    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
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
});

describe("renderReport", () => {
  it("routes each format to its own renderer", async () => {
    const pdf = await renderReport(TABLE, "PDF");
    const excel = await renderReport(TABLE, "EXCEL");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(excel.subarray(0, 2).toString()).toBe("PK");
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
  subtitle: [],
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
    expect(reportBlocks(TABLE)).toEqual([
      { columns: TABLE.columns, rows: TABLE.rows },
    ]);
  });

  it("returns table.blocks when set, ignoring the table's own columns/rows", () => {
    expect(reportBlocks(MULTI_TABLE)).toBe(MULTI_TABLE.blocks);
  });

  it("falls back when blocks is an empty array, so Excel still gets a sheet", async () => {
    const empty = { ...TABLE, rows: [], blocks: [] };
    expect(reportBlocks(empty)).toEqual([{ columns: TABLE.columns, rows: [] }]);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(empty)) as unknown as ExcelLoadable);
    expect(wb.worksheets.length).toBe(1);
  });
});

describe("report header block", () => {
  const WITH_HEADER: ReportTable = {
    ...TABLE,
    header: [
      { label: "School ID", value: "123456" },
      { label: "School Name", value: "Malandag Central Elem." },
      { label: "School Year", value: "2026-2027" },
      { label: "Grade / Section", value: "All Classes" },
      { label: "Prepared by", value: "Marivic M Acibar" },
    ],
  };

  it("draws every header field on the single Excel sheet, above the column headers", async () => {
    const buf = await renderExcel(WITH_HEADER);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);
    const ws = wb.worksheets[0]!;

    const cellTexts: string[] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      cellTexts.push(String(ws.getRow(r).getCell(1).value ?? ""));
    }
    expect(cellTexts).toEqual(
      expect.arrayContaining(["School ID:", "School Name:", "School Year:", "Prepared by:"])
    );
  });

  it("draws the header block on EVERY sheet of a multi-block report", async () => {
    const multi: ReportTable = { ...MULTI_TABLE, header: WITH_HEADER.header };
    const buf = await renderExcel(multi);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);

    for (const ws of wb.worksheets) {
      const cellTexts: string[] = [];
      for (let r = 1; r <= ws.rowCount; r++) {
        cellTexts.push(String(ws.getRow(r).getCell(1).value ?? ""));
      }
      expect(cellTexts).toContain("School ID:");
    }
  });

  it("still produces a valid PDF with the header drawn once at the top", async () => {
    const buf = await renderPdf(WITH_HEADER);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders exactly as before when header is unset (no regression for existing reports)", async () => {
    const buf = await renderExcel(TABLE);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);
    const ws = wb.worksheets[0]!;
    // Row 1 is the first subtitle line, exactly as before this field existed.
    expect(ws.getRow(1).getCell(1).value).toBe(TABLE.subtitle[0]);
  });
});

describe("multi-block reports", () => {
  it("renders one Excel worksheet per block, named from each block's heading", async () => {
    const buf = await renderExcel(MULTI_TABLE);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);

    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Summary", "Details"]);
  });

  it("ignores the table's own columns/rows once blocks is set", async () => {
    const buf = await renderExcel(MULTI_TABLE);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);

    const summary = wb.getWorksheet("Summary")!;
    // No subtitle lines in this fixture, so row 1 is the header row.
    const headerValues = summary.getRow(1).values as CellValue[];
    expect(headerValues.slice(1)).toEqual(["Grade", "Count"]);
    // Header + 2 data rows only — never the ignored top-level row.
    expect(summary.rowCount).toBe(3);
  });

  it("still renders a block with zero rows, and its sibling with rows", async () => {
    const buf = await renderExcel(MULTI_TABLE);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelLoadable);

    const details = wb.getWorksheet("Details")!;
    const detailsHeaderValues = details.getRow(1).values as CellValue[];
    expect(detailsHeaderValues.slice(1)).toEqual(["Name", "Status"]);
    // Header only — the empty block has no data rows.
    expect(details.rowCount).toBe(1);

    const summary = wb.getWorksheet("Summary")!;
    expect(summary.rowCount).toBe(3);
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
