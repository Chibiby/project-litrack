import "server-only";

import {
  FOOTER_LOGO_BUFFERS,
  FOOTER_LOGO_HEIGHT,
  SYSTEM_GENERATED_NOTE,
  writeSheetFooter,
  writeSheetHeader,
  type ReportFooter,
  type ReportHeaderField,
} from "@/lib/reports/sheet-header";

/**
 * Turns a report table into a downloadable file, in either format the hub
 * offers. Every report kind reduces to the same `ReportTable` shape first, so
 * neither renderer knows what a learner or an attendance row is — adding a
 * sixth report means writing one query, not two exporters.
 */

/** A DepEd-style "Label: Value" header line (School ID, School Year, ...). Re-exported from `sheet-header.ts`, the shared module every Excel-producing action now draws this block from. */
export type { ReportHeaderField };

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
  /**
   * Number of leading columns (e.g. "#" and "Learner") to freeze alongside
   * the header row on a wide grid (SF2's one-column-per-school-day matrix).
   * Optional and additive — a block that omits it keeps freezing only the
   * header row, matching every block before this field existed.
   */
  freezeColumns?: number;
  /**
   * 0-based indices into `rows` that render bold with a light shaded fill —
   * SF2's "MALE / TOTAL Per Day", "FEMALE / TOTAL Per Day" and "COMBINED
   * TOTAL PER DAY" rows. Optional; omitted means no row gets this treatment.
   */
  boldRowIndices?: number[];
  /**
   * Parallel to `rows`: `shadedCells[r][c] === true` marks that one cell with
   * a light grey fill — SF2 uses this for a school day with NO attendance
   * record at all, so it reads differently from a recorded "present" (also
   * blank). Optional; a block that omits it (or a row that is shorter than
   * `rows[r]`) shades nothing.
   */
  shadedCells?: boolean[][];
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
  /**
   * DepEd-style report header ("School ID", "School Name", "Region",
   * "School Year", "Grade / Section", "Prepared by", ...), drawn at the top
   * of EVERY Excel sheet and once at the top of the PDF. Optional: a report
   * that omits it renders exactly as it did before this field existed.
   */
  header?: ReportHeaderField[];
  /**
   * The shared "Prepared by / Noted by / system-generated" footer, drawn
   * after the last row of EVERY Excel sheet and once at the end of the PDF.
   * Optional for the same reason `header` is: a report that omits it renders
   * exactly as it did before this field existed.
   */
  footer?: ReportFooter;
};

/**
 * The single place that decides what a renderer iterates. A `ReportTable`
 * with no `blocks` is just a one-block report — both renderers go through
 * this so neither ever reads `table.columns` / `table.rows` directly.
 */
export function reportBlocks(table: ReportTable): ReportBlock[] {
  // An EMPTY `blocks` falls back too: SF2 attendance over a weekend-only range
  // has no month to emit, and zero blocks would write a zero-sheet workbook
  // (which Excel refuses to open) and a PDF with no "no records" line.
  return table.blocks && table.blocks.length > 0
    ? table.blocks
    : [{ columns: table.columns, rows: table.rows }];
}

/** Widths are in characters for Excel and scaled to points for the PDF. */
const DEFAULT_COL_WIDTH = 18;

const THIN_BORDER = {
  top: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
  left: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
  right: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
};

const GREY_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFE5E5E5" },
};

const TOTAL_ROW_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFF3F0FF" },
};

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

    ws.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };

    // The DepEd-style header block ("School ID", "School Name", ...) is drawn
    // on EVERY sheet, not just the first — a School Head who prints one
    // month's SF2 sheet in isolation still needs to know whose it is.
    // Subtitle lines (school, filters, generated-at) belong to the report as
    // a whole, not to any one block, so they go on the first sheet only.
    if (table.header && table.header.length > 0) {
      writeSheetHeader(ws, table.header, i === 0 ? table.subtitle : []);
    } else if (i === 0) {
      for (const line of table.subtitle) {
        ws.addRow([line]);
      }
      if (table.subtitle.length > 0) ws.addRow([]);
    }

    const headerRowIdx = ws.rowCount + 1;
    const headerRow = ws.addRow(block.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEDE9FE" },
      };
      cell.border = THIN_BORDER;
    });

    const boldRows = new Set(block.boldRowIndices ?? []);
    block.rows.forEach((row, rowIdx) => {
      const excelRow = ws.addRow(row.map((v) => (v === null ? "" : v)));
      const isBold = boldRows.has(rowIdx);
      excelRow.eachCell((cell, colNumber) => {
        cell.border = THIN_BORDER;
        if (isBold) {
          cell.font = { bold: true };
          cell.fill = TOTAL_ROW_FILL;
        } else if (block.shadedCells?.[rowIdx]?.[colNumber - 1]) {
          cell.fill = GREY_FILL;
        }
      });
    });

    if (block.note) {
      const noteRow = ws.addRow([block.note]);
      noteRow.font = { italic: true, color: { argb: "FF666666" } };
    }

    // The shared "Prepared by / Noted by / system-generated" footer, on
    // EVERY sheet — same reasoning as the header repeating per sheet.
    if (table.footer) {
      writeSheetFooter(wb, ws, table.footer);
    }

    ws.columns.forEach((col, idx) => {
      col.width = block.columns[idx]?.width ?? DEFAULT_COL_WIDTH;
    });

    // Freeze the header row so it stays visible while scrolling rows, and
    // additionally freeze `block.freezeColumns` leading columns (e.g. "#"
    // and "Learner") so they stay visible while scrolling a wide day-by-day
    // matrix. `freezeColumns` unset behaves exactly as before this field
    // existed (header-row-only freeze).
    ws.views = [{ state: "frozen", xSplit: block.freezeColumns ?? 0, ySplit: headerRowIdx }];
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

    // The DepEd-style header block, once, at the top of the document —
    // unlike Excel's per-sheet repeat, a PDF's pages are one continuous
    // document so one copy at the top is enough.
    if (table.header && table.header.length > 0) {
      doc.font("Helvetica").fontSize(9);
      for (const field of table.header) {
        doc.font("Helvetica-Bold").text(`${field.label}: `, left, doc.y, { continued: true });
        doc.font("Helvetica").text(field.value);
      }
      doc.moveDown(0.3);
    }

    doc.font("Helvetica").fontSize(9).fillColor("#555");
    for (const line of table.subtitle) doc.text(line, left, doc.y);
    doc.fillColor("#000");
    doc.moveDown(0.8);

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
      widths: number[],
      rowH: number,
      fontSize: number,
      shaded?: boolean[]
    ) {
      ensureSpace(rowH);
      const y = doc.y;
      let x = left;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      if (bold) {
        doc.rect(left, y - 2, usable, rowH).fill("#EDE9FE");
        doc.fillColor("#000");
      }
      cells.forEach((cell, i) => {
        const w = widths[i] ?? DEFAULT_COL_WIDTH;
        if (!bold && shaded?.[i]) {
          doc.rect(x, y - 2, w, rowH).fill("#E5E5E5");
          doc.fillColor("#000");
        }
        doc.text(cell === null ? "" : String(cell), x + 2, y + 2, {
          width: w - 4,
          height: rowH,
          ellipsis: true,
          lineBreak: false,
        });
        x += w;
      });
      doc.y = y + rowH;
    }

    const blocks = reportBlocks(table);

    blocks.forEach((block, idx) => {
      // Column widths are proportional to the declared character widths, so
      // a narrow "Grade" column stays narrow instead of every column equal.
      const weights = block.columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const widths = weights.map((w) => (w / total) * usable);

      // A wide SF2-style matrix (one column per school day) needs a smaller
      // font and tighter row height so columns stay proportionally readable
      // instead of clipping every cell's text.
      const wide = block.columns.length > 15;
      const fontSize = wide ? 6 : 8;
      const rowH = wide ? 13 : 16;

      if (block.heading) {
        // A heading that cannot fit itself plus two rows starts a new page,
        // so a block heading never orphans at the foot of a page.
        ensureSpace(HEADING_H + rowH * 2);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");
        doc.text(block.heading, left, doc.y);
        doc.moveDown(0.4);
      }

      const boldRows = new Set(block.boldRowIndices ?? []);
      drawRow(
        block.columns.map((c) => c.header),
        true,
        widths,
        rowH,
        fontSize
      );
      block.rows.forEach((row, rowIdx) => {
        drawRow(row, boldRows.has(rowIdx), widths, rowH, fontSize, block.shadedCells?.[rowIdx]);
      });

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

    // The shared footer, once at the end of the document (a PDF's pages are
    // one continuous document, same reasoning `header` above gives for
    // drawing only once here vs. per-sheet in Excel). A page break first if
    // it would not otherwise fit, never after — see `ensureSpace`.
    if (table.footer) {
      const FOOTER_H = 95;
      ensureSpace(FOOTER_H);
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
      doc.text("Prepared by: ", left, doc.y, { continued: true });
      doc.font("Helvetica").text(table.footer.preparedBy);
      doc.font("Helvetica-Bold").text("Noted by: ", left, doc.y, { continued: true });
      doc.font("Helvetica").text(table.footer.notedBy);
      doc.moveDown(0.3);
      doc
        .font("Helvetica-Oblique")
        .fontSize(8)
        .fillColor("#666")
        .text(SYSTEM_GENERATED_NOTE, left, doc.y);
      doc.fillColor("#000");
      doc.moveDown(0.4);
      const logoY = doc.y;
      let logoX = left;
      for (const logo of FOOTER_LOGO_BUFFERS) {
        doc.image(logo.buffer, logoX, logoY, { height: FOOTER_LOGO_HEIGHT });
        logoX += logo.width + 6;
      }
    }

    doc.end();
  });
}

export async function renderReport(
  table: ReportTable,
  format: "EXCEL" | "PDF"
): Promise<Buffer> {
  return format === "PDF" ? renderPdf(table) : renderExcel(table);
}
