import { describe, it, expect, vi } from "vitest";

/**
 * `buildReadingLevelTable` renders `ReadingLevelRecord.englishProfile` /
 * `filipinoProfile`, which became nullable so a monthly assessment can be saved
 * partially filled. A null profile must render as an empty cell — never the
 * literal string "null", which is what `READING_PROFILE_LABELS[null]` would
 * coerce to via template/array access, and never a thrown error from indexing
 * a label map with a non-string key.
 */

const readingLevelRecordFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    readingLevelRecord: { findMany: (...args: unknown[]) => readingLevelRecordFindMany(...(args as [])) },
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

describe("buildReadingLevelTable — null profile rendering", () => {
  it("renders an empty cell, not the string 'null', for a row with no profile yet", async () => {
    readingLevelRecordFindMany.mockResolvedValueOnce([
      {
        weekStart: new Date(2026, 7, 3),
        englishProfile: null,
        filipinoProfile: null,
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        writingLevel: null,
        notes: null,
        learner: {
          firstName: "Asriel Gabby",
          middleName: "B.",
          lastName: "Andrews",
          gradeLevel: { type: "G3" },
          section: { name: "A" },
        },
      },
    ]);

    const table = await buildReadingLevelTable(SCOPE, {});
    const [row] = table.rows;
    // English, Filipino columns — indices 4 and 5 in the column list.
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[4]).not.toBe("null");
    expect(row[5]).not.toBe("null");
  });

  it("keeps labeling a fully-assessed row exactly as before", async () => {
    readingLevelRecordFindMany.mockResolvedValueOnce([
      {
        weekStart: new Date(2026, 7, 3),
        englishProfile: "INDEPENDENT_GRADE_READY",
        filipinoProfile: "INSTRUCTIONAL_DEVELOPING",
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        writingLevel: null,
        notes: null,
        learner: {
          firstName: "Asriel Gabby",
          middleName: "B.",
          lastName: "Andrews",
          gradeLevel: { type: "G3" },
          section: { name: "A" },
        },
      },
    ]);

    const table = await buildReadingLevelTable(SCOPE, {});
    const [row] = table.rows;
    expect(row[4]).toBe("Independent / Grade-level Ready");
    expect(row[5]).toBe("Instructional / Developing or Transitioning");
  });
});

describe("buildReadingLevelTable — surname-first ordering and tenancy", () => {
  it("orders by lastName then firstName, not by the retired fullName column", async () => {
    readingLevelRecordFindMany.mockResolvedValueOnce([]);

    await buildReadingLevelTable(SCOPE, {});

    const args = readingLevelRecordFindMany.mock.calls[0][0] as { orderBy: unknown[] };
    expect(args.orderBy).toEqual([
      { weekStart: "asc" },
      { learner: { lastName: "asc" } },
      { learner: { firstName: "asc" } },
      { id: "asc" },
    ]);
  });

  it("carries schoolId on the learner predicate", async () => {
    readingLevelRecordFindMany.mockResolvedValueOnce([]);

    await buildReadingLevelTable(SCOPE, {});

    const args = readingLevelRecordFindMany.mock.calls[0][0] as {
      where: { learner: { schoolId?: string } };
    };
    expect(args.where.learner.schoolId).toBe("school-1");
  });
});
