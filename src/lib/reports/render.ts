import "server-only";

/**
 * Turns a report table into a downloadable file, in either format the hub
 * offers. Every report kind reduces to the same `ReportTable` shape first, so
 * neither renderer knows what a learner or an attendance row is — adding a
 * sixth report means writing one query, not two exporters.
 */

export type ReportTable = {
  /** Sheet name and PDF heading. */
  title: string;
  /** School name, filter summary, generated-at line. */
  subtitle: string[];
  columns: { header: string; width?: number }[];
  rows: (string | number | null)[][];
};

/** Widths are in characters for Excel and scaled to points for the PDF. */
const DEFAULT_COL_WIDTH = 18;

export async function renderExcel(table: ReportTable): Promise<Buffer> {
  // Dynamic import keeps exceljs off every cold path that does not export,
  // matching `export-learners.ts` and `term-grades.ts`.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "LITRACK";
  wb.created = new Date();

  // Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ]
  const sheetName = table.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
  const ws = wb.addWorksheet(sheetName || "Report");

  for (const line of table.subtitle) {
    ws.addRow([line]);
  }
  if (table.subtitle.length > 0) ws.addRow([]);

  const headerRow = ws.addRow(table.columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEDE9FE" },
    };
  });

  for (const row of table.rows) {
    ws.addRow(row.map((v) => (v === null ? "" : v)));
  }

  ws.columns.forEach((col, i) => {
    col.width = table.columns[i]?.width ?? DEFAULT_COL_WIDTH;
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

    // Column widths are proportional to the declared character widths, so a
    // narrow "Grade" column stays narrow instead of every column being equal.
    const weights = table.columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const widths = weights.map((w) => (w / total) * usable);

    const ROW_H = 16;
    const FONT_SIZE = 8;

    function drawRow(cells: (string | number | null)[], bold: boolean) {
      // A new page before the row is drawn, never after — otherwise the last
      // row of a page renders into the margin and is clipped.
      if (doc.y + ROW_H > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
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

    drawRow(
      table.columns.map((c) => c.header),
      true
    );
    for (const row of table.rows) drawRow(row, false);

    if (table.rows.length === 0) {
      doc.moveDown(1);
      doc
        .font("Helvetica-Oblique")
        .fontSize(10)
        .fillColor("#666")
        .text("No records matched these filters.", left, doc.y);
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
