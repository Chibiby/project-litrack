import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSchoolRoster, normalizeHeader } from "@/lib/import/school-roster";

/** Build an in-memory .xlsx from a 2-D array of cell values. */
async function makeWorkbook(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((cells, i) => {
    const row = ws.getRow(i + 1);
    cells.forEach((v, c) => {
      if (v !== null) row.getCell(c + 1).value = v;
    });
    row.commit();
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Mirrors the real sheet: a banner row above the header, then ID / NAME / DISTRICT. */
const HEADER = ["NO.", "SCHOOL ID", "SCHOOL NAME", "DISTRICT"];
const BANNER = ["PLANNING CHECKLIST OF REPORTS SUBMISSION", null, null, null];

describe("normalizeHeader", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeHeader("  SCHOOL   ID.  ")).toBe("school id");
  });
});

describe("parseSchoolRoster", () => {
  it("finds the header beneath a banner row instead of assuming row 1", async () => {
    const buf = await makeWorkbook([
      BANNER,
      HEADER,
      [1, 500282, "Alabel Integrated SPED Center", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.headerRow).toBe(2);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].sourceRow).toBe(3);
  });

  it("coerces a numeric school id cell to a string", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].schoolIdCode).toBe("500282");
    expect(typeof res.rows[0].schoolIdCode).toBe("string");
  });

  it("preserves leading zeros in a text id cell", async () => {
    const buf = await makeWorkbook([HEADER, [1, "012345", "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].schoolIdCode).toBe("012345");
  });

  it("skips a district banner row rather than erroring on it", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, null, "ALABEL 1 DISTRICT", null],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it("errors when a real school row has a blank id", async () => {
    const buf = await makeWorkbook([HEADER, [1, null, "Nameless ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].field).toBe("schoolIdCode");
  });

  it("errors when a row has an id but no name", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, null, "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].field).toBe("name");
  });

  it("skips fully blank rows without counting them as errors", async () => {
    const buf = await makeWorkbook([HEADER, [null, null, null, null], [1, 500282, "X ES", "Alabel 1"]]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it("skips subtotal and note rows", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, null, "TOTAL", null],
      [null, null, "Prepared by: Juan Dela Cruz", null],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(2);
  });

  it("records an unusable id as missingId with a null code, not as an error", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [null, "No School ID yet", "Datal Bong ES - Green Valley extension", "Kiamba 1"],
      [13, 0, "Nabol NHS (Proposed)", "Malapatan 3"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows.every((r) => r.schoolIdCode === null)).toBe(true);
    expect(res.missingIds).toHaveLength(2);
    expect(res.missingIds[0].rawValue).toBe("No School ID yet");
    expect(res.missingIds[1].rawValue).toBe("0");
  });

  it("collapses internal whitespace in names and districts", async () => {
    const buf = await makeWorkbook([HEADER, [1, 500282, "  Del   Hilado   ES  ", " Alabel   1 "]]);
    const res = await parseSchoolRoster(buf);
    expect(res.rows[0].name).toBe("Del Hilado ES");
    expect(res.rows[0].district).toBe("Alabel 1");
  });

  it("reports duplicate ids with every source row", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 130551, "Del Hilado ES", "Malapatan 2"],
      [null, 130551, "Del Hilado ES (Matlusi Extension)", "Malapatan 2"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.duplicateIds).toEqual([{ value: "130551", sourceRows: [2, 3] }]);
  });

  it("reports duplicate names case-insensitively", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 500282, "Mahayag ES", "Alabel 1"],
      [2, 500283, "MAHAYAG ES", "Glan 2"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.duplicateNames).toHaveLength(1);
    expect(res.duplicateNames[0].sourceRows).toEqual([2, 3]);
  });

  it("counts schools per district, sorted alphabetically", async () => {
    const buf = await makeWorkbook([
      HEADER,
      [1, 500282, "A ES", "Glan 1"],
      [2, 500283, "B ES", "Alabel 1"],
      [3, 500284, "C ES", "Glan 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.districts).toEqual([
      { name: "Alabel 1", count: 1 },
      { name: "Glan 1", count: 2 },
    ]);
  });

  it("matches header aliases rather than fixed column positions", async () => {
    const buf = await makeWorkbook([
      ["#", "DepEd School ID", "Name of School", "School District"],
      [1, 500282, "X ES", "Alabel 1"],
    ]);
    const res = await parseSchoolRoster(buf);
    expect(res.headerRow).toBe(1);
    expect(res.rows[0].district).toBe("Alabel 1");
  });

  it("throws a named error when no header row can be identified", async () => {
    const buf = await makeWorkbook([["a", "b", "c"], ["d", "e", "f"]]);
    await expect(parseSchoolRoster(buf)).rejects.toThrow(/school name/i);
  });
});
