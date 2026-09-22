import { describe, it, expect, vi } from "vitest";

/**
 * `buildClassRosterTable` (`src/lib/reports/queries.ts`) — the learner listing
 * report. Same contract as the other record reports: the Learner cell is
 * surname-first through `formatListingNameFromRecord`, and the roster's own
 * row order agrees with that display (`lastName`/`firstName`), not the
 * retired `fullName` column.
 */

const learnerFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findMany: (...args: unknown[]) => learnerFindMany(...(args as [])) },
  },
}));

const { buildClassRosterTable, reportScope } = await import("@/lib/reports/queries");

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

describe("buildClassRosterTable — surname-first display", () => {
  it("renders the Learner cell as 'Lastname, Firstname Middlename'", async () => {
    learnerFindMany.mockResolvedValueOnce([
      {
        id: "l1",
        firstName: "Juan Miguel",
        middleName: "Reyes",
        lastName: "Dela Cruz",
        gender: "MALE",
        isAralLearner: false,
        gradeLevel: { type: "G3" },
        section: { name: "A" },
      },
    ]);

    const table = await buildClassRosterTable(SCOPE, {});
    const [row] = table.rows;

    // #, Learner, Grade, Section, Gender, ARAL.
    expect(row[1]).toBe("Dela Cruz, Juan Miguel Reyes");
  });

  it("collapses to 'Lastname, Firstname' with no trailing space when there is no middle name", async () => {
    learnerFindMany.mockResolvedValueOnce([
      {
        id: "l1",
        firstName: "Ana",
        middleName: null,
        lastName: "Santos",
        gender: "FEMALE",
        isAralLearner: false,
        gradeLevel: { type: "G3" },
        section: { name: "A" },
      },
    ]);

    const table = await buildClassRosterTable(SCOPE, {});
    const [row] = table.rows;

    expect(row[1]).toBe("Santos, Ana");
    expect(row[1]).not.toMatch(/\s$/);
  });

  it("orders by lastName then firstName, not by the retired fullName column", async () => {
    learnerFindMany.mockResolvedValueOnce([]);

    await buildClassRosterTable(SCOPE, {});

    const args = learnerFindMany.mock.calls[0][0] as { orderBy: unknown[] };
    expect(args.orderBy).toEqual([
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
  });

  it("carries schoolId on the learner predicate", async () => {
    learnerFindMany.mockResolvedValueOnce([]);

    await buildClassRosterTable(SCOPE, {});

    const args = learnerFindMany.mock.calls[0][0] as { where: { schoolId?: string } };
    expect(args.where.schoolId).toBe("school-1");
  });
});
