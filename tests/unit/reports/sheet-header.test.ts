import { describe, expect, it, vi } from "vitest";
import type { Workbook, Worksheet } from "exceljs";

/**
 * `loadReportFrame` / `writePrintSheet` / `writeRecordsSheet`
 * (`src/lib/reports/sheet-header.ts`) — the ONE implementation of the
 * School's End of Term Report print template (and its plain RECORDS
 * counterpart) every Excel-producing action draws through. Pinned here
 * row-by-row with real exceljs, round-tripped through bytes so what is
 * asserted is what a user opens.
 */

// `server-only` throws when imported outside a React Server Component, and
// this module (and its `@/lib/prisma` import) is imported directly here.
vi.mock("server-only", () => ({}));

const schoolFindFirst = vi.fn();
const schoolYearFindFirst = vi.fn();
const userFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findFirst: (...args: unknown[]) => schoolFindFirst(...(args as [])) },
    schoolYear: { findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [])) },
    user: { findFirst: (...args: unknown[]) => userFindFirst(...(args as [])) },
  },
}));

const { loadReportFrame, writePrintSheet, writeRecordsSheet, writeTemplateSheet } = await import(
  "@/lib/reports/sheet-header"
);
const { SYSTEM_GENERATED_NOTE } = await import("@/lib/reports/report-frame");

type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

const FRAME = {
  schoolName: "Malandag Central Elementary School",
  schoolIdCode: "130517",
  region: "XII",
  division: "Sarangani",
  district: "Malungon West",
  address: "Purok 3, Malandag, Malungon",
  schoolYearLabel: "2026-2027",
  schoolHeadName: "Lourdes Santos",
  preparedBy: "Marivic M Acibar",
};

const CTX = { frame: FRAME, generatedOn: new Date(2026, 8, 23) };

const GRADES = {
  reportTitle: "End of Term Report",
  gradeSection: { gradeLevel: "Grade 4", section: "Sampaguita" },
  reportingPeriod: "First Term (Aug–Oct)",
  columns: [
    { header: "#", width: 6 },
    { header: "Complete Name", width: 30 },
    { header: "Mathematics", width: 16 },
    { header: "English", width: 16 },
    { header: "General Average", width: 18 },
  ],
  rows: [
    [1, "Abad, Ana", 90, 88, 89],
    [2, "Zabala, Zeny", 85, null, 85],
  ] as (string | number | null)[][],
  summary: ["2 learner(s), 2 subject(s)"],
};

async function roundTrip(wb: Workbook): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load((await wb.xlsx.writeBuffer()) as unknown as ExcelLoadable);
  return reloaded;
}

async function newBook() {
  const ExcelJS = (await import("exceljs")).default;
  return new ExcelJS.Workbook();
}

/** Every non-empty cell text on the sheet, row-major. */
function texts(ws: Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.isMerged && cell.master !== cell) return;
      const v = cell.value;
      if (v !== null && v !== undefined && v !== "") out.push(String(v));
    });
  });
  return out;
}

/** exceljs's typings omit the `ext` it stores on a fixed-size anchor. */
function extOf(img: { range: unknown }): { width: number; height: number } | undefined {
  return (img.range as { ext?: { width: number; height: number } }).ext;
}

function rowOf(ws: Worksheet, text: string): number {
  let found = -1;
  ws.eachRow((row, n) => {
    if (found !== -1) return;
    row.eachCell((cell) => {
      if (String(cell.value ?? "") === text) found = n;
    });
  });
  return found;
}

describe("loadReportFrame", () => {
  it("makes three schoolId-pinned reads and returns every template field", async () => {
    schoolFindFirst.mockResolvedValueOnce({
      schoolIdCode: "130517",
      name: "Malandag ES",
      region: "XII",
      division: "Sarangani",
      district: "Malungon West",
      address: "Malandag",
    });
    schoolYearFindFirst.mockResolvedValueOnce({ label: "2026-2027" });
    userFindFirst.mockResolvedValueOnce({ fullName: "Lourdes Santos" });

    const frame = await loadReportFrame({ schoolId: "school-1", preparedBy: "Marivic" });

    expect(frame).toEqual({
      schoolName: "Malandag ES",
      schoolIdCode: "130517",
      region: "XII",
      division: "Sarangani",
      district: "Malungon West",
      address: "Malandag",
      schoolYearLabel: "2026-2027",
      schoolHeadName: "Lourdes Santos",
      preparedBy: "Marivic",
    });
    expect(schoolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "school-1", deletedAt: null } })
    );
    expect(schoolYearFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-1", isActive: true } })
    );
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: "school-1", role: "SCHOOL_HEAD", deletedAt: null },
      })
    );
  });

  it("pins the SchoolYear read to the given id, still scoped to the school", async () => {
    schoolFindFirst.mockResolvedValueOnce(null);
    schoolYearFindFirst.mockResolvedValueOnce(null);
    userFindFirst.mockResolvedValueOnce(null);

    await loadReportFrame({ schoolId: "school-1", schoolYearId: "sy-2025", preparedBy: "X" });

    expect(schoolYearFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: "school-1", id: "sy-2025" } })
    );
  });

  it("falls back to the caller's school name and leaves the rest blank, never a placeholder", async () => {
    schoolFindFirst.mockResolvedValueOnce(null);
    schoolYearFindFirst.mockResolvedValueOnce(null);
    userFindFirst.mockResolvedValueOnce(null);

    const frame = await loadReportFrame({
      schoolId: "school-1",
      preparedBy: "X",
      schoolName: "Known Name",
    });

    expect(frame.schoolName).toBe("Known Name");
    expect(frame.schoolHeadName).toBe("");
    expect(frame.region).toBe("");
  });
});

describe("writePrintSheet", () => {
  // The first exceljs load + logo decode in this file; slow cold under full-suite load.
  it("draws the seal centred in row 1 and the three bottom logos, at fixed pixel sizes", { timeout: 30_000 }, async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    writePrintSheet(wb, ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;

    const images = out.getImages();
    expect(images).toHaveLength(4);
    const seal = images.find((img) => img.range.tl.nativeRow === 0)!;
    expect(seal).toBeTruthy();
    expect(extOf(seal)).toEqual({ width: 100, height: 100 });
    // Centred: the seal's left edge sits within a few px of (table px - 100) / 2.
    const widthsPx = [1, 2, 3, 4, 5].map((c) => Math.floor((out.getColumn(c).width ?? 0) * 7 + 5));
    const tablePx = widthsPx.reduce((a, b) => a + b, 0);
    const left =
      widthsPx.slice(0, seal.range.tl.nativeCol).reduce((a, b) => a + b, 0) +
      seal.range.tl.nativeColOff / 9525;
    expect(Math.abs(left - (tablePx - 100) / 2)).toBeLessThanOrEqual(2);

    const bottom = images.filter((img) => img.range.tl.nativeRow > 0);
    expect(bottom).toHaveLength(3);
    // Left to right, all the same height.
    const xs = bottom.map((img) => img.range.tl.nativeCol * 1e7 + img.range.tl.nativeColOff);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (const img of bottom) expect(extOf(img)?.height).toBe(78);
  });

  it("writes the header lines, the uppercase title and both info rows, with no placeholders", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    writePrintSheet(wb, ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;
    const all = texts(out);

    expect(all.slice(0, 8)).toEqual([
      "Republic of the Philippines",
      "DEPARTMENT OF EDUCATION",
      "Region XII",
      "Schools Division of Sarangani",
      "District: Malungon West",
      "Malandag Central Elementary School",
      "School Address: Purok 3, Malandag, Malungon",
      "END OF TERM REPORT",
    ]);
    expect(out.getRow(3).getCell(1).font?.size).toBe(16);
    expect(out.getRow(3).getCell(1).font?.bold).toBe(true);
    expect(all).toContain("School ID: 130517");
    expect(all).toContain("School Year: 2026-2027");
    expect(all).toContain("Report Date: 23 September 2026");
    expect(all).toContain("Grade Level: Grade 4    /    Section: Sampaguita");
    expect(all).toContain("Reporting Period: First Term (Aug–Oct)");
    expect(all.join(" ")).not.toMatch(/\[Enter/);

    const info1 = rowOf(out, "School ID: 130517");
    expect(out.getRow(info1).getCell(1).fill).toMatchObject({ fgColor: { argb: "FFFFF2CC" } });
  });

  it("omits a header line the school has not filled in, and never doubles a 'Division' prefix", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    writePrintSheet(
      wb,
      ws,
      {
        ...CTX,
        frame: {
          ...FRAME,
          region: "[Enter region]",
          division: "Schools Division of Sarangani",
          district: "",
          address: "",
        },
      },
      GRADES
    );
    const all = texts(ws);
    expect(all).toContain("Schools Division of Sarangani");
    expect(all).not.toContain("Schools Division of Schools Division of Sarangani");
    expect(all.some((t) => t.startsWith("Region"))).toBe(false);
    expect(all.some((t) => t.startsWith("District"))).toBe(false);
    expect(all.some((t) => t.startsWith("School Address"))).toBe(false);
  });

  it("styles the table: navy header, pale data rows, integer grades formatted '0', General Average bold", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    const headerRowNum = writePrintSheet(wb, ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;

    const header = out.getRow(headerRowNum);
    expect(header.getCell(1).value).toBe("#");
    expect(header.getCell(1).fill).toMatchObject({ fgColor: { argb: "FF17365D" } });
    expect(header.getCell(2).font).toMatchObject({ bold: true, color: { argb: "FFFFFFFF" } });

    const first = out.getRow(headerRowNum + 1);
    expect(first.getCell(2).value).toBe("Abad, Ana");
    expect(first.getCell(2).alignment?.horizontal).toBe("left");
    expect(first.getCell(3).alignment?.horizontal).toBe("center");
    expect(first.getCell(3).numFmt).toBe("0");
    expect(first.getCell(3).fill).toMatchObject({ fgColor: { argb: "FFF0F4F8" } });
    expect(first.getCell(5).font?.bold).toBe(true);
  });

  it("draws the signature block with a line under each name and the caption", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    writePrintSheet(wb, ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;
    const all = texts(out);

    for (const label of ["Prepared by:", "Checked by:", "Noted by:"]) expect(all).toContain(label);
    expect(all.filter((t) => t === "Signature over printed name")).toHaveLength(3);
    const nameRow = rowOf(out, "Marivic M Acibar");
    expect(out.getRow(nameRow).getCell(1).border?.bottom).toMatchObject({ style: "thin" });
    expect(all).toContain("Lourdes Santos");
    expect(all).toContain("LITRACK | End of Term Report");
    expect(all).toContain("Generated by Marivic M Acibar on 2026-09-23");
    expect(all).toContain(SYSTEM_GENERATED_NOTE);
    expect(all.join(" ")).not.toMatch(/No signature is required/);
  });

  it("sets A4 page setup that repeats the header row and flows long lists onto more pages", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    const headerRowNum = writePrintSheet(wb, ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;

    expect(out.pageSetup).toMatchObject({
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
    });
    expect(ws.pageSetup.printTitlesRow).toBe(`${headerRowNum}:${headerRowNum}`);
    expect(ws.pageSetup.printArea).toBe(`A1:E${ws.rowCount}`);
    expect(ws.headerFooter.oddFooter).toBe("&L LITRACK&C End of Term Report&R Page &P of &N");
    expect(out.views[0]).toMatchObject({ showGridLines: false });
    expect(out.views[0]?.state).not.toBe("frozen");
  });

  it("turns landscape for a table wider than six columns", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Wide");
    writePrintSheet(wb, ws, CTX, {
      ...GRADES,
      columns: Array.from({ length: 7 }, (_, i) => ({ header: `C${i}`, width: 10 })),
      rows: [],
    });
    expect(ws.pageSetup.orientation).toBe("landscape");
  });

  it("registers the four logo files once per workbook, however many sheets draw them", async () => {
    const wb = await newBook();
    for (const name of ["Aug", "Sep", "Oct"]) {
      writePrintSheet(wb, wb.addWorksheet(name), CTX, GRADES);
    }
    const out = await roundTrip(wb);
    for (const ws of out.worksheets) expect(ws.getImages()).toHaveLength(4);
    expect(out.model.media).toHaveLength(4);
  });
});

describe("writeRecordsSheet", () => {
  it("writes a plain sheet: one line, a blank row, the header at row 3, then the data", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    const headerRowNum = writeRecordsSheet(ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;

    expect(headerRowNum).toBe(3);
    expect(out.getRow(1).getCell(1).value).toBe(
      "Malandag Central Elementary School — End of Term Report — generated 2026-09-23 by Marivic M Acibar"
    );
    expect(out.getRow(2).getCell(1).value).toBeNull();
    expect(out.getRow(3).values).toEqual([
      undefined,
      "#",
      "Complete Name",
      "Mathematics",
      "English",
      "General Average",
    ]);
    expect(out.getRow(4).getCell(2).value).toBe("Abad, Ana");
    expect(out.rowCount).toBe(5);
  });

  it("keeps no merged cells and no images, sets an autofilter and freezes below the header", async () => {
    const wb = await newBook();
    const ws = wb.addWorksheet("Grades");
    writeRecordsSheet(ws, CTX, GRADES);
    const out = (await roundTrip(wb)).worksheets[0]!;

    expect(Object.keys((out.model as { merges?: string[] }).merges ?? {})).toHaveLength(0);
    expect(out.getImages()).toHaveLength(0);
    expect(out.autoFilter).toBe("A3:E5");
    expect(out.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    expect(out.views[0]?.showGridLines).not.toBe(false);
  });

  it("is what writeTemplateSheet draws for RECORDS, and the print template for PRINT", async () => {
    const wb = await newBook();
    const records = wb.addWorksheet("R");
    const print = wb.addWorksheet("P");
    expect(writeTemplateSheet(wb, records, CTX, GRADES, "RECORDS")).toBe(3);
    expect(writeTemplateSheet(wb, print, CTX, GRADES, "PRINT")).toBeGreaterThan(10);
    expect(records.getImages()).toHaveLength(0);
    expect(print.getImages()).toHaveLength(4);

    // The merge probe the RECORDS test relies on does see the print sheet's merges.
    const out = await roundTrip(wb);
    const merges = (name: string) =>
      ((out.getWorksheet(name)!.model as { merges?: string[] }).merges ?? []).length;
    expect(merges("P")).toBeGreaterThan(5);
    expect(merges("R")).toBe(0);
  });
});
