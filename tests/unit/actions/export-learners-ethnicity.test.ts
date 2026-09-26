import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellValue, Workbook } from "exceljs";
import { ETHNICITY_LABELS } from "@/lib/constants/enum-labels";
import {
  mapCsvRowToImportCandidate,
  LEARNER_CSV_HEADERS,
} from "@/lib/learners/import-csv";

/**
 * The ethnicity half of the learners Excel export.
 *
 * The sheet used to write `formatEthnicity(...)` — the DISPLAY string, which
 * substitutes the free text for the word "Others" — into a single `Ethnicity`
 * column, and emitted no "specify" column at all. So a learner recorded as
 * Others / "Manobo" left the app as the bare word `Manobo`: not one of the
 * thirteen enum values, indistinguishable from a fabricated ethnicity, and
 * resolving to nothing when those cells are carried back in through
 * `ETHNICITY_LOOKUP`. Both slots lost their answer the same way.
 *
 * These tests pin the repaired contract: four columns, the label column naming
 * the enum and the free text beside it, and the pair round-tripping through the
 * importer's own resolver. The last test is the regression guard — it fails the
 * moment anything folds the free text back into the label column.
 *
 * Only leaf infrastructure is mocked (Prisma, session, audit). Real exceljs runs
 * and the workbook read back is the bytes a School Head would download.
 *
 * The fake clock is `toFake: ["Date"]` for the reason `term-grades-export.test.ts`
 * documents at length: Vitest's default set also fakes `setImmediate`, which
 * exceljs's zip writer flushes through, and `writeBuffer()` then never resolves.
 */

const SCHOOL_ID = "school-malandag";
const HEAD_ID = "head-remedios";

/** Local noon, never a UTC instant — this box is UTC+8 and CI is UTC. */
const TODAY = new Date(2026, 11, 15, 12, 0, 0);

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
  requireSchoolUser: (...args: unknown[]) => requireUser(...args),
}));

const writeAudit = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, writeAudit: (...args: unknown[]) => writeAudit(...args) };
});

const findManyLearner = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findMany: (...args: unknown[]) => findManyLearner(...args) },
    // `loadReportHeader` (`src/lib/reports/sheet-header.ts`) reads the school
    // row and the active school year once for the shared DepEd-style header
    // block; `loadReportFooter` reads the school's School Head. None of the
    // three is asserted on in this file.
    school: {
      findFirst: async () => ({
        schoolIdCode: "123456",
        name: "Malandag ES",
        region: null,
        division: null,
        district: null,
      }),
    },
    schoolYear: { findFirst: async () => ({ label: "2026-2027" }) },
    user: { findFirst: async () => null },
    gradeLevel: { findFirst: async () => ({ id: "grade-g4" }) },
    section: { findFirst: async () => ({ id: "section-sampaguita" }) },
  },
}));

import { exportSchoolHeadLearnersExcel } from "@/lib/actions/export-learners";

/**
 * 20s, not the 5s default. The first test in this file pays for the dynamic
 * `import("exceljs")` and the zip write; run alone it finishes in ~2s, but under
 * a full `vitest run` the workers contend and it crosses 5s intermittently. The
 * timeout is the flake, not the code — so it is raised here rather than made
 * global, and only in the files that unzip a workbook.
 */
vi.setConfig({ testTimeout: 20_000 });

/** A learner row shaped like `learnerExportSelect` returns it. */
function learner(over: Record<string, unknown> = {}) {
  return {
    fullName: "Ana Santos",
    firstName: "Ana",
    middleName: "",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE",
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    governmentBenefits: [],
    parentEducation: "SECONDARY_GRADUATE",
    nutritionalStatus: null,
    ethnicity: null,
    ethnicityOther: null,
    secondaryEthnicity: null,
    secondaryEthnicityOther: null,
    isAralLearner: false,
    gradeLevel: { type: "G4" },
    section: { name: "Sampaguita" },
    modeOfTransportation: null,
    distanceHomeToSchool: null,
    previousTransfers: null,
    aralProfile: null,
    ...over,
  };
}

/**
 * What `Xlsx.load` accepts. exceljs opens its declarations with
 * `declare interface Buffer extends ArrayBuffer {}`, which merges into Node's
 * global `Buffer` and leaves `Buffer.from(...)` unassignable to the very
 * parameter `load()` asks for — the same upstream wart
 * `term-grades-export.test.ts` documents. One cast, confined to the helper.
 */
type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

/** Read the exported workbook back out of the action's base64 payload. */
async function exportSheet(rows: ReturnType<typeof learner>[]) {
  findManyLearner.mockResolvedValue(rows);
  const res = await exportSchoolHeadLearnersExcel({});
  if (!res.ok) throw new Error(`export failed: ${res.error}`);

  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Buffer.from(res.data.base64, "base64") as unknown as ExcelLoadable
  );
  const sheet = wb.getWorksheet("Learners");
  if (!sheet) throw new Error("no Learners sheet");

  // The sheet now opens with the shared DepEd-style header block
  // (`writeSheetHeader`) before the table itself, so the table's own header
  // row is no longer row 1 — find it (first cell "Name") rather than assume.
  let headerRowNum = 1;
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    if (String(sheet.getRow(r).getCell(1).value ?? "") === "Name") {
      headerRowNum = r;
      break;
    }
  }

  const headers = (sheet.getRow(headerRowNum).values as CellValue[])
    .slice(1)
    .map((v) => String(v ?? ""));
  /** One data row as { header: cell }, which is how a human reads the sheet. */
  const cells = (index: number) => {
    const values = (sheet.getRow(headerRowNum + index).values as CellValue[]).slice(1);
    return Object.fromEntries(
      headers.map((h, i) => [h, values[i] == null ? "" : String(values[i])])
    );
  };
  return { headers, cells };
}

describe("learners export — ethnicity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
    requireUser.mockReset();
    writeAudit.mockReset();
    findManyLearner.mockReset();
    requireUser.mockResolvedValue({
      id: HEAD_ID,
      role: "SCHOOL_HEAD",
      schoolId: SCHOOL_ID,
      profileCompleted: true,
      fullName: "Remedios Santos",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the Learners sheet with the shared header and closes it with the shared footer", async () => {
    findManyLearner.mockResolvedValue([learner()]);
    const res = await exportSchoolHeadLearnersExcel({});
    if (!res.ok) throw new Error(`export failed: ${res.error}`);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(res.data.base64, "base64") as unknown as ExcelLoadable
    );
    const sheet = wb.getWorksheet("Learners")!;

    const texts: string[] = [];
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value !== null && cell.value !== "") texts.push(String(cell.value));
      })
    );
    // The PRINT template by default.
    expect(sheet.getRow(3).getCell(1).value).toBe("DEPARTMENT OF EDUCATION");
    expect(texts).toContain("LEARNER LIST");
    expect(texts).toContain("Prepared by:");
    expect(texts).toContain("Noted by:");
    expect(texts).toContain("Signature over printed name");
    expect(texts).toContain("This is a system-generated report from LITRACK.");
    // The seal plus the three bottom logos.
    expect(sheet.getImages().length).toBe(4);
  });
  it("writes plain sortable sheets for purpose RECORDS, and audits the purpose", async () => {
    findManyLearner.mockResolvedValue([learner()]);
    const res = await exportSchoolHeadLearnersExcel({ purpose: "RECORDS" });
    if (!res.ok) throw new Error(`export failed: ${res.error}`);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(res.data.base64, "base64") as unknown as ExcelLoadable);
    for (const name of ["Learners", "ARAL summary"]) {
      const sheet = wb.getWorksheet(name)!;
      expect(sheet.getImages()).toHaveLength(0);
      expect(((sheet.model as { merges?: string[] }).merges ?? []).length).toBe(0);
      expect(sheet.getRow(3).getCell(1).value).toBe("Name");
      expect(sheet.autoFilter).toBeTruthy();
    }
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({ metadata: { purpose: "RECORDS" } });
  });

  it("defaults the audited purpose to PRINT and refuses an unknown one", async () => {
    findManyLearner.mockResolvedValue([learner()]);
    await exportSchoolHeadLearnersExcel({});
    expect(writeAudit.mock.calls[0]?.[0]).toMatchObject({ metadata: { purpose: "PRINT" } });

    const bad = await exportSchoolHeadLearnersExcel({
      purpose: "POSTER" as unknown as "PRINT",
    });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: "Choose Print or Records" });
  });

  it("emits a specify column beside each ethnicity column", async () => {
    const { headers } = await exportSheet([learner()]);

    expect(headers).toContain("Ethnicity");
    expect(headers).toContain("Ethnicity (specify)");
    expect(headers).toContain("Second ethnicity");
    expect(headers).toContain("Second ethnicity (specify)");
    // Beside, not appended at the end — the pair reads as one answer.
    expect(headers.indexOf("Ethnicity (specify)")).toBe(
      headers.indexOf("Ethnicity") + 1
    );
    expect(headers.indexOf("Second ethnicity (specify)")).toBe(
      headers.indexOf("Second ethnicity") + 1
    );
  });

  it("keeps an Others learner's enum answer and free text in separate cells", async () => {
    const { cells } = await exportSheet([
      learner({
        ethnicity: "OTHER",
        ethnicityOther: "Manobo",
        secondaryEthnicity: "OTHER",
        secondaryEthnicityOther: "Tagakaulo",
      }),
    ]);

    const row = cells(1);
    // The regression: this cell used to read "Manobo".
    expect(row["Ethnicity"]).toBe(ETHNICITY_LABELS.OTHER);
    expect(row["Ethnicity (specify)"]).toBe("Manobo");
    expect(row["Second ethnicity"]).toBe(ETHNICITY_LABELS.OTHER);
    expect(row["Second ethnicity (specify)"]).toBe("Tagakaulo");
  });

  it("leaves the specify cells empty for a named ethnicity", async () => {
    const { cells } = await exportSheet([
      learner({ ethnicity: "BISAYA", secondaryEthnicity: "ILONGGO" }),
    ]);

    const row = cells(1);
    expect(row["Ethnicity"]).toBe("Bisaya");
    expect(row["Ethnicity (specify)"]).toBe("");
    expect(row["Second ethnicity"]).toBe("Ilonggo");
    expect(row["Second ethnicity (specify)"]).toBe("");
  });

  it("round-trips both slots through the importer's resolver", async () => {
    const { cells } = await exportSheet([
      learner({
        ethnicity: "OTHER",
        ethnicityOther: "Manobo",
        secondaryEthnicity: "BISAYA",
      }),
    ]);
    const row = cells(1);

    // The four exported cells, carried back in under the importer's own header
    // names. This is the half that was impossible before: `Manobo` alone
    // resolved to nothing and failed validation as an unknown enum value.
    const candidate = mapCsvRowToImportCandidate({
      firstName: "Ana",
      lastName: "Santos",
      age: "10",
      gender: "FEMALE",
      ethnicity: row["Ethnicity"],
      ethnicityOther: row["Ethnicity (specify)"],
      secondaryEthnicity: row["Second ethnicity"],
      secondaryEthnicityOther: row["Second ethnicity (specify)"],
    });

    expect(candidate.ethnicity).toBe("OTHER");
    expect(candidate.ethnicityOther).toBe("Manobo");
    expect(candidate.secondaryEthnicity).toBe("BISAYA");

    // The importer's contract is four columns; the export now carries all four.
    for (const header of [
      "ethnicity",
      "ethnicityOther",
      "secondaryEthnicity",
      "secondaryEthnicityOther",
    ] as const) {
      expect(LEARNER_CSV_HEADERS).toContain(header);
    }
  });
});
