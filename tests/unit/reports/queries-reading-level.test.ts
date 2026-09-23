import { describe, it, expect, vi } from "vitest";

/**
 * `buildReadingLevelTable` renders a GRID: every period (the 1st of each
 * month in range, unioned with any `weekStart` a record actually holds — the
 * live monthly writer stores the 1st of the month, legacy rows from the
 * retired weekly grid hold a Monday) crossed with every in-scope learner,
 * blank where nothing was recorded. A null profile must render as an empty
 * cell — never the literal string "null", which is what
 * `READING_PROFILE_LABELS[null]` would coerce to via template/array access.
 */

const readingLevelRecordFindMany = vi.fn();
const learnerFindMany = vi.fn();
const schoolYearFindFirst = vi.fn();
// `buildReportHeader` reads the school row once for the DepEd-style header
// block; every test here gets the same fixture unless it overrides it.
const schoolFindFirst = vi.fn(async () => ({
  schoolIdCode: "123456",
  name: "Malandag ES",
  region: null,
  division: null,
  district: null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    readingLevelRecord: {
      findMany: (...args: unknown[]) => readingLevelRecordFindMany(...(args as [])),
    },
    learner: { findMany: (...args: unknown[]) => learnerFindMany(...(args as [])) },
    schoolYear: { findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [])) },
    school: { findFirst: (...args: unknown[]) => schoolFindFirst(...(args as [])) },
  },
}));

const { buildReadingLevelTable, reportScope } = await import(
  "@/lib/reports/queries"
);

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

const LEARNER = {
  id: "learner-1",
  firstName: "Asriel Gabby",
  middleName: "B.",
  lastName: "Andrews",
  gradeLevel: { type: "G3" },
  section: { name: "A" },
};

describe("buildReadingLevelTable — the grid", () => {
  it("emits one row per (month period x in-scope learner), blank when no record exists", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    readingLevelRecordFindMany.mockResolvedValueOnce([]);

    const table = await buildReadingLevelTable(SCOPE, { from: "2026-07-15", to: "2026-09-02" });

    // 3 month periods (Jul, Aug, Sep) x 1 learner.
    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) {
      expect(row[4]).toBe(""); // English
      expect(row[5]).toBe(""); // Filipino
    }
  });

  it("renders an empty cell, not the string 'null', for a row with no profile yet", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    readingLevelRecordFindMany.mockResolvedValueOnce([
      {
        weekStart: new Date(2026, 7, 1),
        englishProfile: null,
        filipinoProfile: null,
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        writingLevel: null,
        notes: null,
        learnerId: "learner-1",
      },
    ]);

    const table = await buildReadingLevelTable(SCOPE, { from: "2026-08-01", to: "2026-08-01" });
    const [row] = table.rows;
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[4]).not.toBe("null");
  });

  it("keeps labeling a fully-assessed row exactly as before", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    readingLevelRecordFindMany.mockResolvedValueOnce([
      {
        weekStart: new Date(2026, 7, 1),
        englishProfile: "INDEPENDENT_GRADE_READY",
        filipinoProfile: "INSTRUCTIONAL_DEVELOPING",
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        writingLevel: null,
        notes: null,
        learnerId: "learner-1",
      },
    ]);

    const table = await buildReadingLevelTable(SCOPE, { from: "2026-08-01", to: "2026-08-01" });
    const [row] = table.rows;
    expect(row[4]).toBe("Independent / Grade-level Ready");
    expect(row[5]).toBe("Instructional / Developing or Transitioning");
  });

  it("unions in a legacy Monday weekStart that is not the 1st of its month", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    readingLevelRecordFindMany.mockResolvedValueOnce([
      {
        weekStart: new Date(2026, 7, 10), // a legacy weekly-grid Monday, not the 1st
        englishProfile: "INDEPENDENT_GRADE_READY",
        filipinoProfile: null,
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        writingLevel: null,
        notes: null,
        learnerId: "learner-1",
      },
    ]);

    const table = await buildReadingLevelTable(SCOPE, { from: "2026-08-01", to: "2026-08-31" });

    const legacyRow = table.rows.find((r) => r[0] === "2026-08-10");
    expect(legacyRow).toBeDefined();
    expect(legacyRow?.[4]).toBe("Independent / Grade-level Ready");
    // The month's own 1st is still present as its own period.
    expect(table.rows.some((r) => r[0] === "2026-08-01")).toBe(true);
  });

  it("orders rows by period asc, then lastName then firstName, and carries schoolId", async () => {
    learnerFindMany.mockResolvedValueOnce([]);
    readingLevelRecordFindMany.mockResolvedValueOnce([]);

    await buildReadingLevelTable(SCOPE, { from: "2026-08-01", to: "2026-08-01" });

    const learnerArgs = learnerFindMany.mock.calls[0][0] as {
      orderBy: unknown[];
      where: { schoolId?: string };
    };
    expect(learnerArgs.orderBy).toEqual([
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
    expect(learnerArgs.where.schoolId).toBe("school-1");
  });
});
