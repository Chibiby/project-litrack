import { describe, it, expect, vi } from "vitest";

/**
 * `buildTeacherSummaryTable` (`src/lib/reports/queries.ts`) — the one builder
 * whose name cell is a `User` (the section's adviser), not a `Learner`. Same
 * contract: surname-first through `formatListingNameFromRecord`. The report
 * itself is ordered by class/section name, not by adviser, so there is no
 * adviser-name `orderBy` to check here — only the cell's display shape and
 * that the section predicate stays tenant-scoped.
 */

const sectionFindMany = vi.fn();
const learnerCount = vi.fn();
const attendanceGroupBy = vi.fn();
const readingLevelRecordCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    section: { findMany: (...args: unknown[]) => sectionFindMany(...(args as [])) },
    learner: { count: (...args: unknown[]) => learnerCount(...(args as [])) },
    attendance: { groupBy: (...args: unknown[]) => attendanceGroupBy(...(args as [])) },
    readingLevelRecord: {
      count: (...args: unknown[]) => readingLevelRecordCount(...(args as [])),
    },
    // `loadReportHeader` (`src/lib/reports/sheet-header.ts`) reads these once
    // for the DepEd-style header block every sheet now opens with.
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
    // `loadReportFooter` reads the school's School Head once for "Noted by";
    // no test here asserts on its content.
    user: { findFirst: async () => null },
  },
}));

const { buildTeacherSummaryTable, reportScope } = await import("@/lib/reports/queries");

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

function stubAggregates() {
  learnerCount.mockResolvedValue(0);
  attendanceGroupBy.mockResolvedValue([]);
  readingLevelRecordCount.mockResolvedValue(0);
}

describe("buildTeacherSummaryTable — adviser cell is surname-first", () => {
  it("renders the Adviser cell as 'Lastname, Firstname Middlename'", async () => {
    stubAggregates();
    sectionFindMany.mockResolvedValueOnce([
      {
        id: "sec-1",
        name: "A",
        gradeLevel: { type: "G3" },
        adviser: {
          firstName: "Juan Miguel",
          middleName: "Reyes",
          lastName: "Dela Cruz",
        },
      },
    ]);

    const table = await buildTeacherSummaryTable(SCOPE, {});
    const [row] = table.rows;

    // Class, Adviser, Learners, ARAL, Present, Absent, Excused, Rate, Grade-ready.
    expect(row[1]).toBe("Dela Cruz, Juan Miguel Reyes");
  });

  it("collapses to 'Lastname, Firstname' with no trailing space when there is no middle name", async () => {
    stubAggregates();
    sectionFindMany.mockResolvedValueOnce([
      {
        id: "sec-1",
        name: "A",
        gradeLevel: { type: "G3" },
        adviser: { firstName: "Ana", middleName: null, lastName: "Santos" },
      },
    ]);

    const table = await buildTeacherSummaryTable(SCOPE, {});
    const [row] = table.rows;

    expect(row[1]).toBe("Santos, Ana");
    expect(row[1]).not.toMatch(/\s$/);
  });

  it("shows an em dash for a section with no adviser assigned", async () => {
    stubAggregates();
    sectionFindMany.mockResolvedValueOnce([
      { id: "sec-1", name: "A", gradeLevel: { type: "G3" }, adviser: null },
    ]);

    const table = await buildTeacherSummaryTable(SCOPE, {});
    const [row] = table.rows;

    expect(row[1]).toBe("—");
  });

  it("carries schoolId on the section predicate", async () => {
    stubAggregates();
    sectionFindMany.mockResolvedValueOnce([]);

    await buildTeacherSummaryTable(SCOPE, {});

    const args = sectionFindMany.mock.calls[0][0] as { where: { schoolId?: string } };
    expect(args.where.schoolId).toBe("school-1");
  });
});
