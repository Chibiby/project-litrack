import { describe, expect, it, vi } from "vitest";

/**
 * `buildTermGradesTable` (`src/lib/reports/queries.ts`) groups TermGrade rows
 * into report columns by SUBJECT NAME KEY (trim + lowercase), not by
 * `termSubjectId` — two different grades' `TermSubject` rows are different
 * database rows even when they hold the same name, and the DepEd sheet this
 * report mirrors is read by name, across grades, at once
 * (docs/superpowers/specs/2026-09-14-term-subjects-management-design.md §7).
 *
 * Column order follows the LOWEST position any grade gives that name, then the
 * name itself — so a subject a Grade 7 sheet put first sorts before one a
 * Grade 8 sheet only reaches at position 3, even if Grade 8's rows happen to be
 * read first. Archived subjects are excluded at the query level
 * (`termSubject: { schoolId, deletedAt: null }`), matching "hidden everywhere"
 * from §0 of the design.
 */

const termGradeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    termGrade: { findMany: (...args: unknown[]) => termGradeFindMany(...(args as [])) },
  },
}));

const { buildTermGradesTable, reportScope } = await import("@/lib/reports/queries");

const SCOPE = reportScope({
  schoolId: "school-1",
  teacherId: null,
  schoolName: "Malandag ES",
  actorName: "Marivic M Acibar",
});

function row(overrides: {
  learnerId: string;
  fullName: string;
  gradeType: string;
  section: string | null;
  term: string;
  score?: number | null;
  mark?: string | null;
  subjectName: string;
  subjectPosition: number;
  subjectGradeLevelId?: string;
  learnerGradeLevelId?: string;
  updatedAt?: Date;
}) {
  return {
    term: overrides.term,
    score: overrides.score ?? null,
    mark: overrides.mark ?? null,
    updatedAt: overrides.updatedAt ?? new Date(2026, 8, 1),
    termSubject: {
      name: overrides.subjectName,
      position: overrides.subjectPosition,
      gradeLevelId: overrides.subjectGradeLevelId ?? "grade-current",
    },
    learner: {
      id: overrides.learnerId,
      fullName: overrides.fullName,
      gradeLevelId: overrides.learnerGradeLevelId ?? "grade-current",
      gradeLevel: { type: overrides.gradeType },
      section: overrides.section ? { name: overrides.section } : null,
    },
  };
}

describe("buildTermGradesTable — column grouping by subject NAME, not id", () => {
  it("merges two grades' differently-id'd TermSubject rows into one column by name", async () => {
    // Grade 7's "English" (position 0) and Grade 8's "English" (position 0) are
    // two different TermSubject rows with two different ids, but the report must
    // show one "English" column, not two.
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 87,
        subjectName: "English",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l2",
        fullName: "Bautista, Bert",
        gradeType: "G8",
        section: "A",
        term: "FIRST",
        score: 91,
        subjectName: "English",
        subjectPosition: 0,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    // "Learner", "Grade", "Section", "Term" + ONE "English" column + "General Average".
    expect(table.columns.map((c) => c.header)).toEqual([
      "Learner",
      "Grade",
      "Section",
      "Term",
      "English",
      "General Average",
    ]);
    expect(table.rows).toHaveLength(2);
  });

  it("keys the grouping on trim + lowercase — 'English' and ' english ' are the same column", async () => {
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 87,
        subjectName: "English",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "SECOND",
        score: 90,
        subjectName: " english ",
        subjectPosition: 0,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    const englishColumns = table.columns.filter((c) => c.header.trim().toLowerCase() === "english");
    expect(englishColumns).toHaveLength(1);
  });

  it("orders columns by the LOWEST position any grade gives that name, then by name", async () => {
    // Reading Club is position 3 on Grade 7's sheet but position 1 on Grade 8's —
    // the lower one wins, even though the Grade 7 row is read first here.
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 80,
        subjectName: "Reading Club",
        subjectPosition: 3,
      }),
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 88,
        subjectName: "English",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l2",
        fullName: "Bautista, Bert",
        gradeType: "G8",
        section: "A",
        term: "FIRST",
        score: 92,
        subjectName: "Reading Club",
        subjectPosition: 1,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    // English (position 0) before Reading Club (min position 1, from Grade 8).
    const subjectHeaders = table.columns
      .map((c) => c.header)
      .filter((h) => !["Learner", "Grade", "Section", "Term", "General Average"].includes(h));
    expect(subjectHeaders).toEqual(["English", "Reading Club"]);
  });

  it("uses the FIRST spelling seen as the column header, even if a later row differs only in case", async () => {
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 87,
        subjectName: "MATHEMATICS",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l2",
        fullName: "Bautista, Bert",
        gradeType: "G8",
        section: "A",
        term: "FIRST",
        score: 91,
        subjectName: "Mathematics",
        subjectPosition: 0,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    expect(table.columns.map((c) => c.header)).toContain("MATHEMATICS");
    expect(table.columns.map((c) => c.header)).not.toContain("Mathematics");
  });

  it("scopes the query to active, this-school subjects only — archived and other-school rows never reach the query results", async () => {
    // The query itself excludes archived subjects (`termSubject: { schoolId,
    // deletedAt: null }`); this asserts the WHERE clause the action builds, since
    // the fake here returns whatever it is given rather than filtering — the
    // filtering is Postgres's job in production, the WHERE shape is this test's.
    termGradeFindMany.mockResolvedValueOnce([]);

    await buildTermGradesTable(SCOPE, {});

    expect(termGradeFindMany.mock.calls[0][0].where).toMatchObject({
      termSubject: { schoolId: "school-1", deletedAt: null },
    });
  });

  describe("one learner, two scores under the same name key and term", () => {
    const base = {
      learnerId: "l1",
      fullName: "Abad, Ana",
      gradeType: "G8",
      section: "A",
      term: "FIRST",
      subjectName: "English",
      subjectPosition: 0,
      learnerGradeLevelId: "grade-g8",
    };
    const englishOf = async () => {
      const table = await buildTermGradesTable(SCOPE, {});
      const idx = table.columns.findIndex((c) => c.header === "English");
      expect(table.rows).toHaveLength(1);
      return table.rows[0][idx];
    };

    it("prefers the current grade's subject, whichever order the rows arrive in", async () => {
      const current = row({ ...base, score: 91, subjectGradeLevelId: "grade-g8", updatedAt: new Date(2026, 7, 1) });
      // The old grade's row is NEWER — recency must not beat the current grade.
      const old = row({ ...base, score: 75, subjectGradeLevelId: "grade-g7", updatedAt: new Date(2026, 8, 1) });

      termGradeFindMany.mockResolvedValueOnce([current, old]);
      expect(await englishOf()).toBe(91);
      termGradeFindMany.mockResolvedValueOnce([old, current]);
      expect(await englishOf()).toBe(91);
    });

    it("falls back to the most recently updated row when neither is the current grade", async () => {
      const older = row({ ...base, score: 75, subjectGradeLevelId: "grade-g6", updatedAt: new Date(2026, 7, 1) });
      const newer = row({ ...base, score: 82, subjectGradeLevelId: "grade-g7", updatedAt: new Date(2026, 8, 1) });

      termGradeFindMany.mockResolvedValueOnce([newer, older]);
      expect(await englishOf()).toBe(82);
      termGradeFindMany.mockResolvedValueOnce([older, newer]);
      expect(await englishOf()).toBe(82);
    });
  });

  it("computes the General Average only over present subjects, per learner-term row", async () => {
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 80,
        subjectName: "English",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G7",
        section: "A",
        term: "FIRST",
        score: 90,
        subjectName: "Mathematics",
        subjectPosition: 1,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    // Learner, Grade, Section, Term, English, Mathematics, General Average.
    const [rowValues] = table.rows;
    expect(rowValues[rowValues.length - 1]).toBe(85);
  });
});

describe("buildTermGradesTable — Grade 1 letter marks", () => {
  it("shows a mark cell as its full label, not the raw enum value", async () => {
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Dizon, Divina",
        gradeType: "G1",
        section: "Mabini",
        term: "FIRST",
        mark: "ADVANCING",
        subjectName: "English",
        subjectPosition: 0,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    const idx = table.columns.findIndex((c) => c.header === "English");
    expect(table.rows[0][idx]).toBe("A – Advancing");
  });

  it("leaves the General Average blank/null for a Grade 1 row", async () => {
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Dizon, Divina",
        gradeType: "G1",
        section: "Mabini",
        term: "FIRST",
        mark: "ADVANCING",
        subjectName: "English",
        subjectPosition: 0,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    const [rowValues] = table.rows;
    expect(rowValues[rowValues.length - 1]).toBeNull();
  });

  it("leaves the General Average blank for any row holding a mark, even outside Grade 1", async () => {
    // Defensive: `rowGeneralAverage` also nulls a non-G1 row that somehow
    // carries a mark cell, and the report must not silently average around it.
    termGradeFindMany.mockResolvedValueOnce([
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G3",
        section: "A",
        term: "FIRST",
        mark: "CONNECTING",
        subjectName: "English",
        subjectPosition: 0,
      }),
      row({
        learnerId: "l1",
        fullName: "Abad, Ana",
        gradeType: "G3",
        section: "A",
        term: "FIRST",
        score: 90,
        subjectName: "Mathematics",
        subjectPosition: 1,
      }),
    ]);

    const table = await buildTermGradesTable(SCOPE, {});

    const [rowValues] = table.rows;
    expect(rowValues[rowValues.length - 1]).toBeNull();
  });
});
