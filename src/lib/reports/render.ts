import "server-only";

import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  BOTTOM_LOGOS,
  TOP_LOGO,
  writeTemplateSheet,
  type GradeSectionLine,
  type ReportFrame,
  type ReportHeaderField,
  type ReportPurpose,
  type TemplateContext,
} from "@/lib/reports/sheet-header";
import {
  DEFAULT_REPORT_PURPOSE,
  EMPTY_REPORT_FRAME,
  SIGNATURE_CAPTION,
  SYSTEM_GENERATED_NOTE,
  templateHeaderLines,
  templateInfoRows,
} from "@/lib/reports/report-frame";

/**
 * Turns a report table into a downloadable file, in either format the hub
 * offers. Every report kind reduces to the same `ReportTable` shape first, so
 * neither renderer knows what a learner or an attendance row is — adding a
 * sixth report means writing one query, not two exporters.
 *
 * Both renderers draw the School's End of Term Report print template
 * (`sheet-header.ts` for Excel, `renderPdf` below); Excel additionally has a
 * RECORDS purpose, a plain sortable data sheet.
 */

/** A DepEd-style "Label: Value" header line. Re-exported for existing importers. */
export type { ReportHeaderField };

export type ReportBlock = {
  /** PDF section heading, Excel title-row suffix, and Excel tab name fallback when `sheetName` is unset. */
  heading?: string;
  /**
   * Short Excel tab name, distinct from `heading`. Optional: when unset,
   * `renderExcel` falls back to `heading` (sanitized/truncated to 31 chars).
   * Exists because two long headings that only differ past character 31
   * (e.g. "...(English)" vs "...(Filipino)") truncate to the same tab name.
   */
  sheetName?: string;
  columns: { header: string; width?: number }[];
  rows: (string | number | null)[][];
  /** Annotation drawn after the block's rows (SF2's legend and totals). */
  note?: string;
  /** Leading columns (e.g. "#" and "Learner") frozen alongside the header row. */
  freezeColumns?: number;
  /** 0-based indices into `rows` that render bold with a light fill (SF2 totals). */
  boldRowIndices?: number[];
  /** Parallel to `rows`: `true` greys that one cell (SF2: no attendance record). */
  shadedCells?: boolean[][];
};

export type ReportTable = {
  /** The report's title: title row, sheet name for a single block, PDF title. */
  title: string;
  /** Count / notes lines printed under the table (school name and the generated line live in the frame). */
  summary: string[];
  /** Info row 2's right half: a term, a date range, the MOSY window. Defaults to "As of <today>". */
  reportingPeriod?: string;
  /** Info row 2's left half. */
  gradeSection?: GradeSectionLine;
  columns: { header: string; width?: number }[];
  rows: (string | number | null)[][];
  /**
   * When set, this wins over `columns`/`rows` above, which are ignored — see
   * `reportBlocks`.
   */
  blocks?: ReportBlock[];
  /** School, school year and signatories. A table without one prints the template with those blank. */
  frame?: ReportFrame;
};

export type RenderOptions = {
  purpose?: ReportPurpose;
  /** The school-local day to stamp on the report. Defaults to `schoolToday()`. */
  generatedOn?: Date;
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

function contextFor(table: ReportTable, opts: RenderOptions): TemplateContext {
  return {
    frame: table.frame ?? EMPTY_REPORT_FRAME,
    generatedOn: opts.generatedOn ?? schoolToday(),
  };
}

export async function renderExcel(table: ReportTable, opts: RenderOptions = {}): Promise<Buffer> {
  // Dynamic import keeps exceljs off every cold path that does not export,
  // matching `export-learners.ts` and `term-grades.ts`.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  const purpose = opts.purpose ?? DEFAULT_REPORT_PURPOSE;
  const ctx = contextFor(table, opts);
  const blocks = reportBlocks(table);
  const usedSheetNames = new Set<string>();

  blocks.forEach((block, i) => {
    // A single-block report names its sheet from the report title; a
    // multi-block report names each sheet from its heading.
    const baseName =
      blocks.length > 1
        ? sanitizeSheetName(block.sheetName ?? block.heading ?? `${table.title} ${i + 1}`)
        : sanitizeSheetName(table.title);
    const ws = wb.addWorksheet(uniqueSheetName(baseName, usedSheetNames));

    // Every sheet gets the whole template, not just the first — a School
    // Head who prints one month's SF2 sheet in isolation still needs to know
    // whose it is and who signs it.
    writeTemplateSheet(
      wb,
      ws,
      ctx,
      {
        reportTitle: table.title,
        sheetTitle: block.heading ? `${table.title} — ${block.heading}` : undefined,
        gradeSection: table.gradeSection,
        reportingPeriod: table.reportingPeriod,
        columns: block.columns,
        rows: block.rows,
        summary: table.summary,
        note: block.note,
        boldRowIndices: block.boldRowIndices,
        shadedCells: block.shadedCells,
        freezeColumns: block.freezeColumns,
      },
      purpose
    );
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// PDF.
// ---------------------------------------------------------------------------

const INK = "#172B42";
const NAVY = "#17365D";
const MUTED = "#64748B";
const HEADER_FILL = "#17365D";
const INFO_FILL = "#FFF2CC";
const DATA_FILL = "#F0F4F8";
const DATA_RULE = "#CBD5E1";
const TOTAL_FILL = "#E2E8F0";
const SHADED_FILL = "#D9D9D9";

function argbToHex(argb: string): string {
  return `#${argb.slice(2)}`;
}

/** The first column not headed "#": left-aligned, like the Excel template. */
function primaryColumn(columns: { header: string }[]): number {
  const idx = columns.findIndex((c) => c.header.trim() !== "#");
  return idx === -1 ? 0 : idx;
}

export async function renderPdf(table: ReportTable, opts: RenderOptions = {}): Promise<Buffer> {
  // Dynamic import for the same reason as exceljs above: pdfkit and its font
  // data are dead weight on every request that is not producing a PDF.
  const PDFDocument = (await import("pdfkit")).default;
  const ctx = contextFor(table, opts);
  const blocks = reportBlocks(table);
  const maxCols = blocks.reduce((m, b) => Math.max(m, b.columns.length), 0);

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: maxCols > 6 ? "landscape" : "portrait",
      margins: { top: 30, bottom: 44, left: 30, right: 30 },
      // Buffered so every page can be stamped "Page x of y" once the total
      // is known.
      bufferPages: true,
      // pdfkit resolves its standard-14 AFM metrics from disk at draw time.
      // Helvetica is one of those, so no font file ships with this app.
      info: { Title: table.title, Author: "LITRACK" },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

    // A new page before the content is drawn, never after — otherwise the
    // last row (or heading) of a page renders into the margin and is clipped.
    function ensureSpace(h: number): boolean {
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        return true;
      }
      return false;
    }

    function centred(text: string, size: number, color: string, bold = false) {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .fillColor(color)
        .text(text, left, doc.y, { width: usable, align: "center" });
    }

    // --- Header: seal, lines, rule, title, info rows. ---
    const SEAL = 56;
    doc.image(TOP_LOGO.buffer, left + usable / 2 - SEAL / 2, doc.y, { width: SEAL, height: SEAL });
    doc.y += SEAL + 4;
    for (const line of templateHeaderLines(ctx.frame)) {
      const size = line.size >= 16 ? 13 : line.size >= 12 ? 10.5 : 9;
      centred(line.text, size, argbToHex(line.color), line.bold);
    }
    doc.y += 4;
    doc.moveTo(left, doc.y).lineTo(left + usable, doc.y).lineWidth(1.5).strokeColor(NAVY).stroke();
    doc.y += 8;
    centred(table.title.toUpperCase(), 13, INK, true);
    doc.y += 6;

    const info = templateInfoRows({
      frame: ctx.frame,
      gradeSection: table.gradeSection,
      reportingPeriod: table.reportingPeriod,
      reportDate: ctx.generatedOn,
    });
    const INFO_H = 16;
    function infoRow(texts: string[], fractions: number[], fill?: string) {
      const y = doc.y;
      if (fill) doc.rect(left, y, usable, INFO_H).fill(fill);
      let x = left;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK);
      texts.forEach((t, i) => {
        const w = usable * fractions[i]!;
        doc.text(t, x + 2, y + 4, { width: w - 4, align: "center", lineBreak: false, ellipsis: true });
        x += w;
      });
      doc.y = y + INFO_H;
    }
    infoRow(info.first, [0.4, 0.3, 0.3], INFO_FILL);
    infoRow(info.second, [0.4, 0.6]);
    doc.y += 10;

    // --- Tables. ---
    blocks.forEach((block, idx) => {
      // Column widths are proportional to the declared character widths, so
      // a narrow "Grade" column stays narrow instead of every column equal.
      const weights = block.columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      const widths = weights.map((w) => (w / total) * usable);
      const primary = primaryColumn(block.columns);

      // A wide SF2-style matrix (one column per school day) needs a smaller
      // font and tighter row height so columns stay proportionally readable.
      const wide = block.columns.length > 15;
      const fontSize = wide ? 6 : 8;
      const rowH = wide ? 13 : 16;

      doc.font("Helvetica-Bold").fontSize(fontSize);
      const headerH = Math.max(
        rowH + 4,
        ...block.columns.map(
          (c, i) => doc.heightOfString(c.header, { width: Math.max(widths[i]! - 4, 4) }) + 8
        )
      );

      function drawHeader() {
        const y = doc.y;
        doc.rect(left, y, usable, headerH).fill(HEADER_FILL);
        let x = left;
        doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#FFFFFF");
        block.columns.forEach((c, i) => {
          const w = widths[i]!;
          if (i > 0) {
            doc.moveTo(x, y).lineTo(x, y + headerH).lineWidth(0.5).strokeColor("#FFFFFF").stroke();
          }
          doc.text(c.header, x + 2, y + 4, { width: w - 4, height: headerH - 4, align: "center" });
          x += w;
        });
        doc.y = y + headerH;
      }

      function drawRow(cells: (string | number | null)[], bold: boolean, shaded?: boolean[]) {
        // Page break BEFORE the row, then the header again on the new page.
        if (ensureSpace(rowH)) drawHeader();
        const y = doc.y;
        doc.rect(left, y, usable, rowH).fill(bold ? TOTAL_FILL : DATA_FILL);
        let x = left;
        cells.forEach((cell, i) => {
          const w = widths[i] ?? DEFAULT_COL_WIDTH;
          if (!bold && shaded?.[i]) doc.rect(x, y, w, rowH).fill(SHADED_FILL);
          doc
            .font(bold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(fontSize)
            .fillColor(INK)
            .text(cell === null ? "" : String(cell), x + 2, y + (rowH - fontSize) / 2, {
              width: w - 4,
              height: rowH,
              ellipsis: true,
              lineBreak: false,
              align: i === primary ? "left" : "center",
            });
          x += w;
        });
        doc
          .moveTo(left, y + rowH)
          .lineTo(left + usable, y + rowH)
          .lineWidth(0.5)
          .strokeColor(DATA_RULE)
          .stroke();
        doc.y = y + rowH;
      }

      if (block.heading && blocks.length > 1) {
        // A heading that cannot fit itself plus the header and two rows
        // starts a new page, so it never orphans at the foot of a page.
        ensureSpace(20 + headerH + rowH * 2);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
        doc.text(block.heading, left, doc.y);
        doc.y += 4;
      } else {
        ensureSpace(headerH + rowH * 2);
      }

      drawHeader();
      const boldRows = new Set(block.boldRowIndices ?? []);
      block.rows.forEach((row, rowIdx) => {
        drawRow(row, boldRows.has(rowIdx), block.shadedCells?.[rowIdx]);
      });

      if (block.rows.length === 0) {
        ensureSpace(20);
        doc.y += 6;
        doc
          .font("Helvetica-Oblique")
          .fontSize(9)
          .fillColor(MUTED)
          .text("No records matched these filters.", left, doc.y);
      }

      if (block.note) {
        doc.font("Helvetica").fontSize(8);
        const h = doc.heightOfString(block.note, { width: usable });
        ensureSpace(h + 8);
        doc.y += 6;
        doc.fillColor(INK).text(block.note, left, doc.y, { width: usable });
      }

      if (idx < blocks.length - 1) doc.y += 14;
    });

    // --- Summary lines. ---
    if (table.summary.length > 0) {
      doc.font("Helvetica").fontSize(9);
      const h = table.summary.reduce(
        (sum, line) => sum + doc.heightOfString(line, { width: usable }),
        0
      );
      ensureSpace(h + 10);
      doc.y += 10;
      for (const line of table.summary) {
        doc.fillColor(INK).text(line, left, doc.y, { width: usable });
      }
    }

    // --- Signature block, rule, bottom logos + generated lines. ---
    const LOGO_H = 40;
    const SIGNATURE_H = 78;
    ensureSpace(SIGNATURE_H + 14 + LOGO_H + 6);
    doc.y += 20;
    const sigTop = doc.y;
    const colW = usable / 3;
    const labels = ["Prepared by:", "Checked by:", "Noted by:"];
    const names = [ctx.frame.preparedBy, "", ctx.frame.schoolHeadName];
    labels.forEach((_, i) => {
      const x = left + colW * i + 12;
      const w = colW - 24;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
      doc.text(labels[i]!, x, sigTop, { width: w, align: "center" });
      doc.text(names[i]!, x, sigTop + 36, { width: w, align: "center", lineBreak: false, ellipsis: true });
      doc
        .moveTo(x, sigTop + 48)
        .lineTo(x + w, sigTop + 48)
        .lineWidth(0.75)
        .strokeColor(MUTED)
        .stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
      doc.text(SIGNATURE_CAPTION, x, sigTop + 51, { width: w, align: "center" });
    });
    doc.y = sigTop + SIGNATURE_H - 14;
    doc.moveTo(left, doc.y).lineTo(left + usable, doc.y).lineWidth(0.75).strokeColor(NAVY).stroke();
    doc.y += 6;

    const logoTop = doc.y;
    let logoX = left;
    for (const logo of BOTTOM_LOGOS) {
      const w = Math.round((LOGO_H / logo.height) * logo.width);
      doc.image(logo.buffer, logoX, logoTop, { width: w, height: LOGO_H });
      logoX += w + 6;
    }
    const textX = Math.max(logoX + 10, left + usable * 0.4);
    const textW = left + usable - textX;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    [
      `LITRACK | ${table.title}`,
      `Generated by ${ctx.frame.preparedBy} on ${formatLocalDateKey(ctx.generatedOn)}`,
      SYSTEM_GENERATED_NOTE,
    ].forEach((line, i) => {
      doc.text(line, textX, logoTop + 6 + i * 11, { width: textW, align: "right", lineBreak: false });
    });

    // --- "Page x of y" on every page, inside the bottom margin. ---
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const savedBottom = doc.page.margins.bottom;
      // Writing inside the margin would otherwise make pdfkit add a page.
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 26;
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
      doc.text("LITRACK", left, y, { width: usable, align: "left", lineBreak: false });
      doc.text(table.title, left, y, { width: usable, align: "center", lineBreak: false });
      doc.text(`Page ${p - range.start + 1} of ${range.count}`, left, y, {
        width: usable,
        align: "right",
        lineBreak: false,
      });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

export async function renderReport(
  table: ReportTable,
  format: "EXCEL" | "PDF",
  opts: RenderOptions = {}
): Promise<Buffer> {
  // A PDF is always the print template; RECORDS is an Excel-only purpose.
  return format === "PDF" ? renderPdf(table, opts) : renderExcel(table, opts);
}
