import { describe, it, expect, vi } from "vitest";

/**
 * `buildAttendanceTable` (`src/lib/reports/queries.ts`) — the Learner cell must
 * read surname-first through the shared `formatListingNameFromRecord`
 * (`src/lib/names.ts`), matching what the screen shows for the same learner,
 * and the row order must be alphabetised by the same field it displays
 * (`lastName`/`firstName`), not by the legacy `fullName` column, or a report
 * that reads surname-first while sorting first-name-first is not alphabetised
 * from the reader's point of view.
 */

const attendanceFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { findMany: (...args: unknown[]) => attendanceFindMany(...(args as [])) },
  },
}));

const { buildAttendanceTable, reportScope } = await import("@/lib/reports/queries");

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

describe("buildAttendanceTable — surname-first display", () => {
  it("renders the Learner cell as 'Lastname, Firstname Middlename'", async () => {
    attendanceFindMany.mockResolvedValueOnce([
      {
        date: new Date(2026, 7, 3),
        status: "PRESENT",
        notes: null,
        learner: {
          firstName: "Juan Miguel",
          middleName: "Reyes",
          lastName: "Dela Cruz",
          gradeLevel: { type: "G3" },
          section: { name: "A" },
        },
      },
    ]);

    const table = await buildAttendanceTable(SCOPE, {});
    const [row] = table.rows;

    // Date, Learner, Grade, Section, Status, Reason/Remarks.
    expect(row[1]).toBe("Dela Cruz, Juan Miguel Reyes");
  });

  it("collapses to 'Lastname, Firstname' with no trailing space when there is no middle name", async () => {
    attendanceFindMany.mockResolvedValueOnce([
      {
        date: new Date(2026, 7, 3),
        status: "PRESENT",
        notes: null,
        learner: {
          firstName: "Ana",
          middleName: null,
          lastName: "Santos",
          gradeLevel: { type: "G3" },
          section: { name: "A" },
        },
      },
    ]);

    const table = await buildAttendanceTable(SCOPE, {});
    const [row] = table.rows;

    expect(row[1]).toBe("Santos, Ana");
    expect(row[1]).not.toMatch(/\s$/);
  });

  it("orders by lastName then firstName, not by the retired fullName column", async () => {
    attendanceFindMany.mockResolvedValueOnce([]);

    await buildAttendanceTable(SCOPE, {});

    const args = attendanceFindMany.mock.calls[0][0] as { orderBy: unknown[] };
    expect(args.orderBy).toEqual([
      { date: "asc" },
      { learner: { lastName: "asc" } },
      { learner: { firstName: "asc" } },
      { id: "asc" },
    ]);
  });

  it("carries schoolId on the learner predicate", async () => {
    attendanceFindMany.mockResolvedValueOnce([]);

    await buildAttendanceTable(SCOPE, {});

    const args = attendanceFindMany.mock.calls[0][0] as {
      where: { learner: { schoolId?: string } };
    };
    expect(args.where.learner.schoolId).toBe("school-1");
  });
});
