import { afterEach, describe, it, expect, vi } from "vitest";

/**
 * `buildAttendanceTable` (`src/lib/reports/queries.ts`) renders a GRID: every
 * school day in the resolved range crossed with every in-scope learner
 * (`learnerWhere`), blank where nothing was recorded — not a flat dump of
 * whatever `Attendance` rows exist. The Learner cell reads surname-first
 * through the shared `formatListingNameFromRecord` (`src/lib/names.ts`),
 * matching what the screen shows for the same learner, and rows are ordered
 * date asc then by the same field the cell displays (`lastName`/`firstName`),
 * not the legacy `fullName` column.
 */

const attendanceFindMany = vi.fn();
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
    attendance: { findMany: (...args: unknown[]) => attendanceFindMany(...(args as [])) },
    learner: { findMany: (...args: unknown[]) => learnerFindMany(...(args as [])) },
    schoolYear: { findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [])) },
    school: { findFirst: (...args: unknown[]) => schoolFindFirst(...(args as [])) },
  },
}));

const { buildAttendanceTable, reportScope } = await import("@/lib/reports/queries");

// Each test sets exactly the mock returns it needs; clearing between tests
// keeps an earlier test's `mockResolvedValueOnce`/call count from leaking
// into a later one's `not.toHaveBeenCalled()` assertion.
afterEach(() => {
  vi.clearAllMocks();
});

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

const LEARNER = {
  id: "learner-1",
  firstName: "Juan Miguel",
  middleName: "Reyes",
  lastName: "Dela Cruz",
  gradeLevel: { type: "G3" },
  section: { name: "A" },
};

const LEARNER_2 = {
  id: "learner-2",
  firstName: "Ana",
  middleName: null,
  lastName: "Santos",
  gradeLevel: { type: "G3" },
  section: { name: "A" },
};

/** Aug 24-28, 2026 are Mon-Fri — five school days, no weekend to drop. */
const RANGE = { from: "2026-08-24", to: "2026-08-28" };

describe("buildAttendanceTable — the grid", () => {
  it("emits one row per (date x in-scope learner), blank when no Attendance row exists", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER, LEARNER_2]);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, RANGE);

    // 5 weekdays x 2 learners = 10 rows, every one blank.
    expect(table.rows).toHaveLength(10);
    for (const row of table.rows) {
      expect(row[4]).toBe(""); // Status
      expect(row[5]).toBe(""); // Reason / Remarks
    }
  });

  it("fills a cell from its Attendance row and leaves the rest of that date's row blank", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER, LEARNER_2]);
    attendanceFindMany.mockResolvedValueOnce([
      { date: new Date(2026, 7, 25), status: "PRESENT", notes: null, learnerId: "learner-1" },
    ]);

    const table = await buildAttendanceTable(SCOPE, RANGE);

    const filled = table.rows.find(
      (r) => r[0] === "2026-08-25" && r[1] === "Dela Cruz, Juan Miguel Reyes"
    );
    expect(filled?.[4]).toBe("Present");
    const stillBlank = table.rows.find(
      (r) => r[0] === "2026-08-25" && r[1] === "Santos, Ana"
    );
    expect(stillBlank?.[4]).toBe("");
  });

  it("unions in a weekend date that actually has a record, rather than dropping it", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    attendanceFindMany.mockResolvedValueOnce([
      // 2026-08-30 is a Sunday, outside the Mon-Fri enumeration.
      { date: new Date(2026, 7, 30), status: "PRESENT", notes: null, learnerId: "learner-1" },
    ]);

    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-24", to: "2026-08-30" });

    const sundayRow = table.rows.find((r) => r[0] === "2026-08-30");
    expect(sundayRow).toBeDefined();
    expect(sundayRow?.[4]).toBe("Present");
  });

  it("renders the Learner cell as 'Lastname, Firstname Middlename'", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-24", to: "2026-08-24" });
    expect(table.rows[0][1]).toBe("Dela Cruz, Juan Miguel Reyes");
  });

  it("collapses to 'Lastname, Firstname' with no trailing space when there is no middle name", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER_2]);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-24", to: "2026-08-24" });
    expect(table.rows[0][1]).toBe("Santos, Ana");
    expect(table.rows[0][1]).not.toMatch(/\s$/);
  });

  it("orders rows by date asc, then lastName then firstName", async () => {
    learnerFindMany.mockResolvedValueOnce([LEARNER, LEARNER_2]);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-24", to: "2026-08-25" });

    expect(table.rows.map((r) => [r[0], r[1]])).toEqual([
      ["2026-08-24", "Dela Cruz, Juan Miguel Reyes"],
      ["2026-08-24", "Santos, Ana"],
      ["2026-08-25", "Dela Cruz, Juan Miguel Reyes"],
      ["2026-08-25", "Santos, Ana"],
    ]);
  });

  it("carries schoolId on the learner predicate for both reads", async () => {
    learnerFindMany.mockResolvedValueOnce([]);
    attendanceFindMany.mockResolvedValueOnce([]);

    await buildAttendanceTable(SCOPE, RANGE);

    const learnerArgs = learnerFindMany.mock.calls[0][0] as { where: { schoolId?: string } };
    expect(learnerArgs.where.schoolId).toBe("school-1");
    const attendanceArgs = attendanceFindMany.mock.calls[0][0] as {
      where: { learner: { schoolId?: string } };
    };
    expect(attendanceArgs.where.learner.schoolId).toBe("school-1");
  });

  it("caps the grid to the latest school days when it would exceed the cell budget, and notes it", async () => {
    // 2001 learners x 6 days = 12006 > 10000, so the cap keeps floor(10000/2001) = 4 days.
    const manyLearners = Array.from({ length: 2001 }, (_, i) => ({
      id: `l${i}`,
      firstName: "A",
      middleName: null,
      lastName: `L${String(i).padStart(4, "0")}`,
      gradeLevel: { type: "G3" },
      section: { name: "A" },
    }));
    learnerFindMany.mockResolvedValueOnce(manyLearners);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, { from: "2026-08-24", to: "2026-08-31" });

    const dateKeys = [...new Set(table.rows.map((r) => r[0]))];
    expect(dateKeys).toHaveLength(4);
    // The kept dates are the LATEST, not the earliest.
    expect(dateKeys).toContain("2026-08-28");
    expect(dateKeys).not.toContain("2026-08-24");
    expect(table.subtitle.some((l) => l.includes("Showing the latest"))).toBe(true);
  });
});

describe("buildAttendanceTable — default range resolution", () => {
  it("uses the active school year, clamped to today, when neither from nor to is supplied", async () => {
    schoolYearFindFirst.mockResolvedValueOnce({
      startDate: new Date(2026, 7, 24),
      endDate: new Date(2026, 7, 28),
    });
    learnerFindMany.mockResolvedValueOnce([LEARNER]);
    attendanceFindMany.mockResolvedValueOnce([]);

    const table = await buildAttendanceTable(SCOPE, {});

    expect(table.subtitle.some((l) => l.includes("active school year"))).toBe(true);
    expect(table.rows).toHaveLength(5); // 5 weekdays x 1 learner
  });

  it("skips the school-year lookup when `from` is supplied", async () => {
    learnerFindMany.mockResolvedValueOnce([]);
    attendanceFindMany.mockResolvedValueOnce([]);

    await buildAttendanceTable(SCOPE, { from: "2026-08-24" });

    expect(schoolYearFindFirst).not.toHaveBeenCalled();
  });
});
