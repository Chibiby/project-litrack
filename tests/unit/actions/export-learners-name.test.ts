import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellValue, Workbook } from "exceljs";
import { formatListingNameFromRecord } from "@/lib/names";
import { buildAttendanceTable, reportScope } from "@/lib/reports/queries";

/**
 * The learners Excel export's name columns.
 *
 * Sheet 1 used to carry a `Full name` column populated from the denormalized
 * `Learner.fullName` ("Firstname Middlename Lastname" — never surname-first).
 * The owner asked for every name column, on screen and on paper, to read
 * surname-first, so the header is renamed to `Name` and populated through the
 * same shared formatter every other name cell in the app goes through
 * (`formatListingNameFromRecord`, `src/lib/names.ts`).
 *
 * The hazard this guards against: `First name` / `Middle name` / `Last name`
 * are the lossless, machine-readable columns a re-import actually needs, and
 * they must NOT change shape just because the display column next to them
 * did. A test that only checked the new `Name` column would still pass if
 * someone accidentally reformatted `Last name` too — so every test below
 * asserts all four cells together.
 *
 * The fake clock is `toFake: ["Date"]` — see `export-learners-ethnicity.test.ts`
 * for why (exceljs's zip writer flushes through `setImmediate`, which
 * Vitest's default fake-timer set also fakes).
 */

const SCHOOL_ID = "school-malandag";
const HEAD_ID = "head-remedios";
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
const attendanceFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findMany: (...args: unknown[]) => findManyLearner(...args) },
    attendance: { findMany: (...args: unknown[]) => attendanceFindMany(...args) },
    school: {
      findUnique: async () => ({ name: "Malandag ES" }),
      // `buildReportHeader` (Reports Hub) reads the school row once for its
      // DepEd-style header block; the export action's own `school.findUnique`
      // above is a separate call this test does not touch.
      findFirst: async () => ({
        schoolIdCode: "123456",
        name: "Malandag ES",
        region: null,
        division: null,
        district: null,
      }),
    },
    // `loadReportHeader` also reads the active school year for the shared
    // header's "School Year" field; `loadReportFooter` reads the school's
    // School Head. Neither is asserted on here.
    schoolYear: { findFirst: async () => ({ label: "2026-2027" }) },
    user: { findFirst: async () => null },
    gradeLevel: { findFirst: async () => ({ id: "grade-g4" }) },
    section: { findFirst: async () => ({ id: "section-sampaguita" }) },
  },
}));

import { exportSchoolHeadLearnersExcel } from "@/lib/actions/export-learners";

vi.setConfig({ testTimeout: 20_000 });

/** A learner row shaped like `learnerExportSelect` returns it. */
function learner(over: Record<string, unknown> = {}) {
  return {
    fullName: "Juan Miguel Reyes Dela Cruz",
    firstName: "Juan Miguel",
    middleName: "Reyes",
    lastName: "Dela Cruz",
    age: 10,
    gender: "MALE",
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

type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

async function exportSheets(rows: ReturnType<typeof learner>[]) {
  findManyLearner.mockResolvedValue(rows);
  const res = await exportSchoolHeadLearnersExcel({});
  if (!res.ok) throw new Error(`export failed: ${res.error}`);

  const ExcelJS = (await import("exceljs")).default;
  const wb: Workbook = new ExcelJS.Workbook();
  await wb.xlsx.load(
    Buffer.from(res.data.base64, "base64") as unknown as ExcelLoadable
  );

  function readSheet(name: string) {
    const sheet = wb.getWorksheet(name);
    if (!sheet) throw new Error(`no ${name} sheet`);

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
    const cells = (index: number) => {
      const values = (sheet.getRow(headerRowNum + index).values as CellValue[]).slice(1);
      return Object.fromEntries(
        headers.map((h, i) => [h, values[i] == null ? "" : String(values[i])])
      );
    };
    return { headers, cells };
  }

  return { learners: readSheet("Learners") };
}

describe("learners export — name columns", () => {
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

  it("renames the Full name column header to Name", async () => {
    const { learners } = await exportSheets([learner()]);
    expect(learners.headers).toContain("Name");
    expect(learners.headers).not.toContain("Full name");
  });

  it("populates Name surname-first while First name / Middle name / Last name stay the raw stored parts", async () => {
    const { learners } = await exportSheets([learner()]);
    const row = learners.cells(1);

    expect(row["Name"]).toBe("Dela Cruz, Juan Miguel Reyes");
    // The round-trip guard: the machine-readable triple must NOT be touched by
    // the display rename next to it.
    expect(row["First name"]).toBe("Juan Miguel");
    expect(row["Middle name"]).toBe("Reyes");
    expect(row["Last name"]).toBe("Dela Cruz");
  });

  it("collapses to 'Lastname, Firstname' with no trailing space when there is no middle name", async () => {
    const { learners } = await exportSheets([
      learner({ fullName: "Ana Santos", firstName: "Ana", middleName: "", lastName: "Santos" }),
    ]);
    const row = learners.cells(1);

    expect(row["Name"]).toBe("Santos, Ana");
    expect(row["Name"]).not.toMatch(/\s$/);
  });

  it("orders rows by lastName then firstName within grade, matching the Name column's own alphabetisation", async () => {
    await exportSheets([
      learner({ firstName: "Ana", middleName: "", lastName: "Zamora" }),
      learner({ firstName: "Ben", middleName: "", lastName: "Abad" }),
    ]);

    const args = findManyLearner.mock.calls[0][0] as { orderBy: unknown[] };
    expect(args.orderBy).toEqual([
      { gradeLevelId: "asc" },
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
  });

  it("agrees with the report builders on the same fixture learner — screen and printout render the same string", async () => {
    const fixture = { firstName: "Juan Miguel", middleName: "Reyes", lastName: "Dela Cruz" };

    // The export's Name cell.
    const { learners } = await exportSheets([learner(fixture)]);
    const exportedName = learners.cells(1)["Name"];

    // A report builder's Learner cell, for the identical fixture.
    const SCOPE = reportScope({
      schoolId: SCHOOL_ID,
      teacherId: null,
      schoolName: "Malandag ES",
      actorName: "Marivic M Acibar",
    });
    // `buildAttendanceTable` now renders a grid (date x in-scope learner), so
    // it reads the learner roster separately from the Attendance rows — set
    // both explicitly rather than relying on `exportSheets`'s leftover mock.
    findManyLearner.mockResolvedValueOnce([
      {
        id: "learner-1",
        ...fixture,
        gradeLevel: { type: "G4" },
        section: { name: "Sampaguita" },
      },
    ]);
    attendanceFindMany.mockResolvedValueOnce([
      { date: new Date(2026, 7, 3), status: "PRESENT", notes: null, learnerId: "learner-1" },
    ]);
    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-03", to: "2026-08-03" });
    const reportedName = table.rows[0][1];

    expect(exportedName).toBe(reportedName);
    expect(exportedName).toBe(formatListingNameFromRecord(fixture));
  });
});
