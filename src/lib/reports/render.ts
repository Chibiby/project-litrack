import "server-only";

/**
 * Turns a report table into a downloadable file, in either format the hub
 * offers. Every report kind reduces to the same `ReportTable` shape first, so
 * neither renderer knows what a learner or an attendance row is — adding a
 * sixth report means writing one query, not two exporters.
 */

export type ReportBlock = {
  /** PDF section heading (and Excel tab name fallback when `sheetName` is unset). */
  heading?: string;
  /**
   * Short Excel tab name, distinct from `heading`. Optional: when unset,
   * `renderExcel` falls back to `heading` (sanitized/truncated to 31 chars)
   * exactly as before, so existing blocks and the byte-identical single-block
   * fixture are untouched. Exists because two long headings that only differ
   * past character 31 (e.g. "...(English)" vs "...(Filipino)") truncate to
   * the same tab name and become indistinguishable once `uniqueSheetName`
   * renumbers the second one.
   */
  sheetName?: string;
  columns: { header: string; width?: number }[];
  rows: (string | number | null)[][];
  /** Small italic annotation drawn after the block's rows. */
  note?: string;
};

export type ReportTable = {
  /** Sheet name and PDF heading. */
  title: string;
  /** School name, filter summary, generated-at line. */
  subtitle: string[];
  columns: { header: string; width?: number }[];
  rows: (string | number | null)[][];
  /**
   * When set, this wins over `columns`/`rows` above, which are ignored — see
   * `reportBlocks`. Kept as a separate optional field (rather than replacing
   * `columns`/`rows`) so every existing single-table report keeps compiling
   * and rendering unchanged.
   */
  blocks?: ReportBlock[];
};

/**
 * The single place that decides what a renderer iterates. A `ReportTable`
 * with no `blocks` is just a one-block report — both renderers go through
 * this so neither ever reads `table.columns` / `table.rows` directly.
 */
export function reportBlocks(table: ReportTable): ReportBlock[] {
  return table.blocks ?? [{ columns: table.columns, rows: table.rows }];
}

/** Widths are in characters for Excel and scaled to points for the PDF. */
const DEFAULT_COL_WIDTH = 18;

// Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ]
function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report";
}

// Guards against two blocks sharing a heading (or both having none), which
// would otherwise make ExcelJS throw on the second `addWorksheet` call.
function uniqueSheetName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` (${n})`;
    name = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
    n++;
  }
  used.add(name);
  return name;
}

export async function renderExcel(table: ReportTable): Promise<Buffer> {
  // Dynamic import keeps exceljs off every cold path that does not export,
  // matching `export-learners.ts` and `term-grades.ts`.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  const blocks = reportBlocks(table);
  const usedSheetNames = new Set<string>();

  blocks.forEach((block, i) => {
    // A single-block report keeps today's exact sheet name derived from the
    // report title; a multi-block report names each sheet from its heading.
    const baseName =
      blocks.length > 1
        ? sanitizeSheetName(block.sheetName ?? block.heading ?? `${table.title} ${i + 1}`)
        : sanitizeSheetName(table.title);
    const ws = wb.addWorksheet(uniqueSheetName(baseName, usedSheetNames));

    // Subtitle lines (school, filters, generated-at) belong to the report as
    // a whole, not to any one block, so they go on the first sheet only.
    if (i === 0) {
      for (const line of table.subtitle) {
        ws.addRow([line]);
      }
      if (table.subtitle.length > 0) ws.addRow([]);
    }

    const headerRow = ws.addRow(block.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEDE9FE" },
      };
    });

    for (const row of block.rows) {
      ws.addRow(row.map((v) => (v === null ? "" : v)));
    }

    if (block.note) {
      const noteRow = ws.addRow([block.note]);
      noteRow.font = { italic: true, color: { argb: "FF666666" } };
    }

    ws.columns.forEach((col, idx) => {
      col.width = block.columns[idx]?.width ?? DEFAULT_COL_WIDTH;
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function renderPdf(table: ReportTable): Promise<Buffer> {
  // Dynamic import for the same reason as exceljs above: pdfkit and its font
  // data are dead weight on every request that is not producing a PDF.
  const PDFDocument = (await import("pdfkit")).default;

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36,
      // pdfkit resolves its standard-14 AFM metrics from disk at draw time.
      // Helvetica is one of those, so no font file ships with this app.
      info: { Title: table.title, Author: "LITRACK" },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const usable =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(16).text(table.title, left, doc.y);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor("#555");
    for (const line of table.subtitle) doc.text(line, left, doc.y);
    doc.fillColor("#000");
    doc.moveDown(0.8);

    const ROW_H = 16;
    const FONT_SIZE = 8;
    const HEADING_H = 20;

    // A new page before the content is drawn, never after — otherwise the
    // last row (or heading) of a page renders into the margin and is clipped.
    function ensureSpace(h: number) {
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
    }

    function drawRow(
      cells: (string | number | null)[],
      bold: boolean,
      widths: number[]
    ) {
      ensureSpace(ROW_H);
      const y = doc.y;
      let x = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
      if (bold) {
        doc.rect(left, y - 2, usable, ROW_H).fill("#EDE9FE");
        doc.fillColor("#000");
      }
      cells.forEach((cell, i) => {
        const w = widths[i] ?? DEFAULT_COL_WIDTH;
        doc.text(cell === null ? "" : String(cell), x + 3, y + 2, {
          width: w - 6,
          height: ROW_H,
          ellipsis: true,
          lineBreak: false,
        });
        x += w;
      });
      doc.y = y + ROW_H;
    }

    const blocks = reportBlocks(table);

    blocks.forEach((block, idx) => {
      // Column widths are proportional to the declared character widths, so
      // a narrow "Grade" column stays narrow instead of every column equal.
      const weights = block.columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const widths = weights.map((w) => (w / total) * usable);

      if (block.heading) {
        // A heading that cannot fit itself plus two rows starts a new page,
        // so a block heading never orphans at the foot of a page.
        ensureSpace(HEADING_H + ROW_H * 2);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");
        doc.text(block.heading, left, doc.y);
        doc.moveDown(0.4);
      }

      drawRow(
        block.columns.map((c) => c.header),
        true,
        widths
      );
      for (const row of block.rows) drawRow(row, false, widths);

      if (block.rows.length === 0) {
        doc.moveDown(1);
        doc
          .font("Helvetica-Oblique")
          .fontSize(10)
          .fillColor("#666")
          .text("No records matched these filters.", left, doc.y);
      }

      if (block.note) {
        doc.moveDown(0.5);
        doc
          .font("Helvetica-Oblique")
          .fontSize(8)
          .fillColor("#666")
          .text(block.note, left, doc.y);
      }

      if (idx < blocks.length - 1) doc.moveDown(1);
    });

    doc.end();
  });
}

export async function renderReport(
  table: ReportTable,
  format: "EXCEL" | "PDF"
): Promise<Buffer> {
  return format === "PDF" ? renderPdf(table) : renderExcel(table);
}
