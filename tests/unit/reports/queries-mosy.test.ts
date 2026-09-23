import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `buildMosyTable` (`src/lib/reports/queries.ts`) â€” the Prisma half of the
 * MOSY report. `mosy.ts` (blocks) and `mosy-window.ts` (dates) have their own
 * tests; what is only testable here is the four reads, their tenant
 * predicates, the window/filter interaction and the record pick.
 *
 * Every assertion below fails if the behaviour it names is removed:
 * the tenancy test reads the captured `where` objects, the scope test
 * compares a teacher build against a Super Admin one, and the record-pick
 * test distinguishes "latest" from "latest complete".
 */

const schoolYearFindFirst = vi.fn();
const termWindowOverrideFindMany = vi.fn();
const gradeLevelFindMany = vi.fn();
const learnerFindMany = vi.fn();
// `buildReportHeader` reads the school row once for the DepEd-style header
// block; no test here asserts on its content.
const schoolFindFirst = vi.fn(async () => ({
  schoolIdCode: "123456",
  name: "Malandag ES",
  region: null,
  division: null,
  district: null,
}));

/** Every `where` any of the four reads was called with, in call order. */
const capturedWheres: { model: string; where: unknown }[] = [];

function capture(model: string, fn: ReturnType<typeof vi.fn>) {
  return (args: { where?: unknown }) => {
    capturedWheres.push({ model, where: args?.where });
    return fn(args);
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolYear: { findFirst: capture("schoolYear", schoolYearFindFirst) },
    termWindowOverride: {
      findMany: capture("termWindowOverride", termWindowOverrideFindMany),
    },
    gradeLevel: { findMany: capture("gradeLevel", gradeLevelFindMany) },
    learner: { findMany: capture("learner", learnerFindMany) },
    school: { findFirst: (...a: unknown[]) => schoolFindFirst(...(a as [])) },
  },
}));

const { buildMosyTable, reportScope } = await import("@/lib/reports/queries");

const ADMIN_SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

const TEACHER_SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: "teacher-1",
  schoolName: "Malandag ES",
  actorName: "Jun Dela Cruz",
});

/**
 * School year starting August 2025 â†’ Second Term (MOSY) is Nov 2025 - Jan 2026.
 *
 * Database-shaped (`new Date("YYYY-MM-DD")`, i.e. UTC midnight), matching how
 * `createSchoolYear` writes `startDate` and how `getTermWindows` reads the
 * anchor month back. A fixture built from local date fields is a value this
 * app never writes and anchors the terms to the wrong month off UTC.
 */
const SCHOOL_YEAR = {
  id: "sy-1",
  startDate: new Date("2025-08-04"),
  endDate: new Date("2026-04-30"),
  label: "2025-2026",
};

const GRADES = [
  { id: "grade-5", type: "G5" },
  { id: "grade-6", type: "G6" },
];

type RecordRow = {
  weekStart: Date;
  englishProfile: string | null;
  filipinoProfile: string | null;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
};

function learnerRow(overrides: {
  id: string;
  lastName: string;
  gradeType?: string;
  gradeLevelId?: string;
  isAralLearner?: boolean;
  /** Selected the same way as `learner`'s own name fields (defect: this used
   * to be a single `fullName`, which rendered next to the surname-first
   * `Learner` column in the wrong convention â€” see queries.ts). */
  aralTutor?: { firstName: string; middleName?: string | null; lastName: string } | null;
  profile?: { updatedAt: Date; suggestedInterventions: string[] } | null;
  readingLevels?: RecordRow[];
}) {
  return {
    id: overrides.id,
    firstName: "Ana",
    middleName: null,
    lastName: overrides.lastName,
    gradeLevelId: overrides.gradeLevelId ?? "grade-5",
    isAralLearner: overrides.isAralLearner ?? false,
    gradeLevel: { type: overrides.gradeType ?? "G5" },
    section: { name: "Sampaguita" },
    aralTeacher: overrides.aralTutor ?? null,
    aralProfile: overrides.profile ?? null,
    readingLevels: overrides.readingLevels ?? [],
  };
}

/** A record that satisfies `isReadingRecordComplete` for a both-languages grade. */
function completeRecord(weekStart: Date): RecordRow {
  return {
    weekStart,
    englishProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_3",
    readingComprehensionLevel: "LEVEL_2",
  };
}

/** Same, minus the English profile â€” incomplete for G5. */
function partialRecord(weekStart: Date): RecordRow {
  return { ...completeRecord(weekStart), englishProfile: null };
}

function learnerWhereOf(): Record<string, unknown> {
  const entry = capturedWheres.find((c) => c.model === "learner");
  return (entry?.where ?? {}) as Record<string, unknown>;
}

function gradeWhereOf(): Record<string, unknown> {
  const entry = capturedWheres.find((c) => c.model === "gradeLevel");
  return (entry?.where ?? {}) as Record<string, unknown>;
}

/** The `where` the nested `readingLevels` select was filtered by. */
function readingLevelsWhere(): Record<string, unknown> {
  const args = learnerFindMany.mock.calls[0][0] as {
    select: { readingLevels: { where: Record<string, unknown> } };
  };
  return args.select.readingLevels.where;
}

beforeEach(() => {
  capturedWheres.length = 0;
  vi.clearAllMocks();
  schoolYearFindFirst.mockResolvedValue(SCHOOL_YEAR);
  termWindowOverrideFindMany.mockResolvedValue([]);
  gradeLevelFindMany.mockResolvedValue(GRADES);
  learnerFindMany.mockResolvedValue([]);
});

describe("buildMosyTable â€” tenancy", () => {
  it("carries schoolId on every where, school year and term overrides included", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});

    // Four reads: school year, its overrides, grades, learners.
    expect(capturedWheres.map((c) => c.model)).toEqual([
      "schoolYear",
      "termWindowOverride",
      "gradeLevel",
      "learner",
    ]);
    for (const captured of capturedWheres) {
      expect(
        (captured.where as { schoolId?: string })?.schoolId,
        `${captured.model} where is missing schoolId`
      ).toBe("school-1");
    }
    // The override read must be pinned to the year as well, or a head's
    // override from another year would move this year's window.
    const overrideWhere = capturedWheres[1].where as { schoolYearId?: string };
    expect(overrideWhere.schoolYearId).toBe("sy-1");
  });

  it("selects the active year when no schoolYearId filter is given, and the named one when it is", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});
    expect(capturedWheres[0].where).toMatchObject({ schoolId: "school-1", isActive: true });

    capturedWheres.length = 0;
    await buildMosyTable(ADMIN_SCOPE, { schoolYearId: "sy-9" });
    expect(capturedWheres[0].where).toMatchObject({ schoolId: "school-1", id: "sy-9" });
    expect(capturedWheres[0].where).not.toHaveProperty("isActive");
  });
});

describe("buildMosyTable â€” scope", () => {
  it("narrows grades and learners for a TEACHER", async () => {
    await buildMosyTable(TEACHER_SCOPE, {});

    // Advised UNION ARAL-tutored (`teacherLearnerScope`) â€” the same scope
    // every other builder uses, deliberately NOT the tutor-only one.
    expect(learnerWhereOf().OR).toEqual([
      { teacherId: "teacher-1" },
      { aralTeacherId: "teacher-1" },
    ]);
    expect(gradeWhereOf().OR).toEqual([
      { sections: { some: { deletedAt: null, adviser: { id: "teacher-1" } } } },
      { learners: { some: { aralTeacherId: "teacher-1", deletedAt: null } } },
    ]);
  });

  it("does not narrow for a SUPER_ADMIN viewing a school", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});

    // A Super Admin passes every role check by impersonation; treating them
    // as a teacher would scope them to an empty advisory and export nothing.
    expect(learnerWhereOf()).not.toHaveProperty("OR");
    expect(gradeWhereOf()).not.toHaveProperty("OR");
    expect(learnerWhereOf()).toMatchObject({
      schoolId: "school-1",
      deletedAt: null,
      archivedAt: null,
    });
  });
});

describe("buildMosyTable â€” the window", () => {
  it("uses the school year's Second Term as a half-open range", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});

    expect(readingLevelsWhere()).toEqual({
      weekStart: { gte: new Date(2025, 10, 1), lt: new Date(2026, 1, 1) },
    });
  });

  it("honours a Second Term override", async () => {
    termWindowOverrideFindMany.mockResolvedValue([
      {
        term: "SECOND",
        startKey: "2025-12-01",
        endKey: "2025-12-20",
        deadlineKey: "2025-12-20",
      },
    ]);

    const table = await buildMosyTable(ADMIN_SCOPE, {});

    expect(readingLevelsWhere()).toEqual({
      weekStart: { gte: new Date(2025, 11, 1), lt: new Date(2025, 11, 21) },
    });
    expect(table.auditMeta).toMatchObject({
      windowStartKey: "2025-12-01",
      windowEndKey: "2025-12-20",
    });
  });

  it("lets `from` alone replace only the start edge, keeping the MOSY end", async () => {
    const table = await buildMosyTable(ADMIN_SCOPE, { from: "2025-12-15" });

    expect(readingLevelsWhere()).toEqual({
      weekStart: {
        gte: new Date(2025, 11, 15),
        // Still the MOSY end (2026-01-31), half-open as +1 day.
        lt: new Date(2026, 1, 1),
      },
    });
    expect(table.auditMeta).toMatchObject({
      windowStartKey: "2025-12-15",
      windowEndKey: "2026-01-31",
      windowSource: "custom",
    });
  });

  it("lets `to` alone replace only the end edge, keeping the MOSY start", async () => {
    const table = await buildMosyTable(ADMIN_SCOPE, { to: "2025-12-15" });

    expect(readingLevelsWhere()).toEqual({
      weekStart: { gte: new Date(2025, 10, 1), lt: new Date(2025, 11, 16) },
    });
    expect(table.auditMeta).toMatchObject({
      windowStartKey: "2025-11-01",
      windowEndKey: "2025-12-15",
      windowSource: "custom",
    });
  });

  it("still generates all four blocks with no school year and no dates", async () => {
    schoolYearFindFirst.mockResolvedValue(null);
    learnerFindMany.mockResolvedValue([learnerRow({ id: "l1", lastName: "Abad" })]);

    const table = await buildMosyTable(ADMIN_SCOPE, {});

    expect(table.blocks).toHaveLength(6);
    expect(table.auditMeta).toMatchObject({
      windowStartKey: null,
      windowEndKey: null,
      windowSource: "unresolved",
    });
    // No year means no override read; the record filter must match NOTHING
    // rather than silently widening to the learner's whole history.
    expect(termWindowOverrideFindMany).not.toHaveBeenCalled();
    expect(readingLevelsWhere()).toEqual({ id: { in: [] } });
    // The learner appears, simply as not assessed.
    const detail = table.blocks![5];
    expect(detail.rows).toHaveLength(1);
    expect(detail.rows[0][11]).toBe("Not assessed");
  });
});

describe("buildMosyTable â€” the record pick", () => {
  it("takes the latest COMPLETE in-window record, not merely the latest", async () => {
    learnerFindMany.mockResolvedValue([
      learnerRow({
        id: "l1",
        lastName: "Abad",
        // Ordered `weekStart` desc, as the query asks for.
        readingLevels: [
          partialRecord(new Date(2026, 0, 5)),
          completeRecord(new Date(2025, 11, 1)),
        ],
      }),
    ]);

    const table = await buildMosyTable(ADMIN_SCOPE, {});
    const detail = table.blocks![5];

    expect(detail.rows[0][6]).toBe("December 2025");
    expect(detail.rows[0][11]).toBe("Complete");
  });

  it("falls back to the latest record and marks it partial when none is complete", async () => {
    learnerFindMany.mockResolvedValue([
      learnerRow({
        id: "l1",
        lastName: "Abad",
        readingLevels: [
          partialRecord(new Date(2026, 0, 5)),
          partialRecord(new Date(2025, 11, 1)),
        ],
      }),
    ]);

    const table = await buildMosyTable(ADMIN_SCOPE, {});
    const detail = table.blocks![5];

    expect(detail.rows[0][6]).toBe("January 2026");
    expect(detail.rows[0][11]).toBe("Partial");
  });
});

describe("buildMosyTable â€” ARAL profiles are optional", () => {
  it("generates for a school with zero profiles and never filters on one", async () => {
    learnerFindMany.mockResolvedValue([
      learnerRow({
        id: "l1",
        lastName: "Abad",
        isAralLearner: true,
        aralTutor: { firstName: "Jun", middleName: null, lastName: "Dela Cruz" },
        profile: null,
        readingLevels: [completeRecord(new Date(2025, 11, 1))],
      }),
    ]);

    const table = await buildMosyTable(ADMIN_SCOPE, {});

    expect(table.blocks).toHaveLength(6);
    // `aralProfile` is a select, never a where â€” no part of the learner
    // predicate may mention it (docs/aral-profile.md).
    expect(JSON.stringify(learnerWhereOf())).not.toContain("aralProfile");
    const args = learnerFindMany.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(args.select.aralProfile).toEqual({
      select: { updatedAt: true, suggestedInterventions: true },
    });

    const detail = table.blocks![5];
    expect(detail.rows[0][12]).toBe("Not completed");
    // The ARAL Tutor column is what makes the advised-union-tutored scope
    // visible on the sheet, formatted surname-first like the Learner column
    // next to it rather than as the raw `fullName` column.
    expect(detail.rows[0][5]).toBe("Dela Cruz, Jun");
  });
});

describe("buildMosyTable â€” person-name conventions", () => {
  it("orders learners by lastName then firstName, not by the retired fullName column", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});

    const args = learnerFindMany.mock.calls[0][0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
  });

  it("selects the ARAL tutor's name parts, not fullName, for surname-first formatting", async () => {
    await buildMosyTable(ADMIN_SCOPE, {});

    const args = learnerFindMany.mock.calls[0][0] as {
      select: { aralTeacher: { select: Record<string, unknown> } };
    };
    expect(args.select.aralTeacher.select).toEqual({
      firstName: true,
      middleName: true,
      lastName: true,
    });
  });
});
