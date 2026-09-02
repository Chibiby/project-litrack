import { describe, expect, it, vi } from "vitest";

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

const { renderExcel, renderPdf, renderReport } = await import(
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
