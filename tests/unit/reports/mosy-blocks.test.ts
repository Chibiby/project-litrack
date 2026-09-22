import { describe, expect, it } from "vitest";
import {
  buildMosyBlocks,
  describeMosyWindowNote,
  type MosyInput,
  type MosyLearner,
} from "@/lib/reports/mosy";

/**
 * `buildMosyBlocks` is pure decision logic: no Prisma, no I/O. Every fixture
 * here is hand-built so a broken rule (a stray `0` where `null` belongs, a
 * block that vanishes when profiles are absent, a mismatched grade total)
 * fails a specific test rather than a snapshot.
 */

const RESOLVED_WINDOW = {
  startKey: "2026-11-01",
  endKey: "2027-01-31",
  label: "November - January",
  source: "term" as const,
};

const KINDER = { id: "grade-k", type: "KINDER", label: "Kinder" };
const G1 = { id: "grade-1", type: "G1", label: "Grade 1" };
const G3 = { id: "grade-3", type: "G3", label: "Grade 3" };

function learner(overrides: Partial<MosyLearner> & Pick<MosyLearner, "id" | "gradeLevelId" | "gradeType" | "gradeLabel">): MosyLearner {
  return {
    sectionName: "Sampaguita",
    firstName: "Juan",
    middleName: null,
    lastName: "Cruz",
    isAralLearner: false,
    aralTutorName: null,
    record: null,
    profile: null,
    ...overrides,
  };
}

function findBlock(blocks: ReturnType<typeof buildMosyBlocks>, heading: string) {
  const block = blocks.find((b) => b.heading === heading);
  if (!block) throw new Error(`block not found: ${heading}`);
  return block;
}

describe("buildMosyBlocks — shape", () => {
  it("always returns exactly four blocks, in order, even with no learners", () => {
    const input: MosyInput = { window: RESOLVED_WINDOW, grades: [KINDER], learners: [] };
    const blocks = buildMosyBlocks(input);
    expect(blocks).toHaveLength(4);
    expect(blocks.map((b) => b.heading)).toEqual([
      "Reading Level Profile per Grade Level (English)",
      "Reading Level Profile per Grade Level (Filipino)",
      "ARAL Profiling",
      "Learner Detail",
    ]);
  });

  it("gives the two language blocks distinct, short Excel sheet names", () => {
    // Both headings truncate to the identical 31-char prefix
    // ("Reading Level Profile per Grade"), so the tab name renderExcel uses
    // must come from a separate, already-distinct field instead.
    const input: MosyInput = { window: RESOLVED_WINDOW, grades: [KINDER], learners: [] };
    const blocks = buildMosyBlocks(input);
    const english = findBlock(blocks, "Reading Level Profile per Grade Level (English)");
    const filipino = findBlock(blocks, "Reading Level Profile per Grade Level (Filipino)");

    expect(english.sheetName).toBe("Reading Level (English)");
    expect(filipino.sheetName).toBe("Reading Level (Filipino)");
    expect(english.sheetName).not.toBe(filipino.sheetName);
    expect(english.sheetName!.length).toBeLessThanOrEqual(31);
    expect(filipino.sheetName!.length).toBeLessThanOrEqual(31);
  });

  it("produces four non-empty blocks when every learner's ARAL profile is null (dormant-safe)", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G3],
      learners: [
        learner({
          id: "l1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: null,
        }),
        learner({
          id: "l2",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: null,
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    expect(blocks).toHaveLength(4);
    for (const block of blocks) {
      expect(block.rows.length).toBeGreaterThan(0);
    }
    const aral = findBlock(blocks, "ARAL Profiling");
    // Two ARAL learners, zero completed profiles — not zero rows, not a thrown error.
    expect(aral.rows[0]).toEqual([G3.label, 2, 0, 2, "0%", null, null]);
  });
});

describe("buildMosyBlocks — Kinder rubric bands", () => {
  it("shows null, not 0, for a Kinder row's bands outside its scale", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      // A standard-scale grade alongside Kinder so the band-column union
      // includes both rubrics.
      grades: [KINDER, G3],
      learners: [
        learner({
          id: "k1",
          gradeLevelId: KINDER.id,
          gradeType: KINDER.type,
          gradeLabel: KINDER.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: "LETTER_LEVEL",
            filipinoProfile: "LETTER_LEVEL",
            wordRecognitionLevel: "LEVEL_1",
            readingComprehensionLevel: "LEVEL_1",
            complete: true,
          },
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const english = findBlock(blocks, "Reading Level Profile per Grade Level (English)");
    const headers = english.columns.map((c) => c.header);
    const kinderRow = english.rows[0]!;

    // Kinder's own band ("Letter Level") must be a real count, never null.
    const letterLevelIdx = headers.indexOf("Level 1 - Letter Level");
    expect(letterLevelIdx).toBeGreaterThan(-1);
    expect(kinderRow[letterLevelIdx]).toBe(1);

    // A standard-scale band Kinder never offers (Grade 3's "Grade-level Ready"
    // band, K3-style label for INDEPENDENT_GRADE_READY) must be null, not 0 —
    // a Kinder row cannot claim zero Independent readers on a scale it never uses.
    const independentIdx = headers.indexOf("Grade-level Ready");
    expect(independentIdx).toBeGreaterThan(-1);
    expect(kinderRow[independentIdx]).toBeNull();
  });
});

describe("buildMosyBlocks — language collection per grade", () => {
  it("nulls the whole Grade 1 row in the English block, but shows real counts in Filipino", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G1],
      learners: [
        learner({
          id: "g1-1",
          gradeLevelId: G1.id,
          gradeType: G1.type,
          gradeLabel: G1.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: null,
            filipinoProfile: "INDEPENDENT_GRADE_READY",
            wordRecognitionLevel: "LEVEL_3",
            readingComprehensionLevel: "LEVEL_2",
            complete: true,
          },
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const english = findBlock(blocks, "Reading Level Profile per Grade Level (English)");
    const filipino = findBlock(blocks, "Reading Level Profile per Grade Level (Filipino)");

    const englishRow = english.rows[0]!;
    // Grade Level label survives; everything else on the row is null.
    expect(englishRow[0]).toBe(G1.label);
    for (const cell of englishRow.slice(1)) {
      expect(cell).toBeNull();
    }

    const filipinoRow = filipino.rows[0]!;
    expect(filipinoRow[1]).toBe(1); // Learners
    expect(filipinoRow[2]).toBe(1); // Assessed
    expect(filipinoRow[3]).toBe(0); // Not Assessed
    expect(filipinoRow[4]).toBe("100%"); // Coverage %
  });
});

describe("buildMosyBlocks — zero-learner grade", () => {
  it("yields a null Coverage %, never NaN or 0", () => {
    const input: MosyInput = { window: RESOLVED_WINDOW, grades: [G3], learners: [] };
    const blocks = buildMosyBlocks(input);
    const english = findBlock(blocks, "Reading Level Profile per Grade Level (English)");
    const row = english.rows[0]!;
    expect(row[1]).toBe(0); // Learners
    const coverageIdx = english.columns.map((c) => c.header).indexOf("Coverage %");
    expect(row[coverageIdx]).toBeNull();
    expect(row[coverageIdx]).not.toBeNaN();
  });
});

describe("buildMosyBlocks — assessment status", () => {
  it("counts a complete record as Assessed and shows Complete; a partial one shows Partial", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G3],
      learners: [
        learner({
          id: "complete-1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: "INDEPENDENT_GRADE_READY",
            filipinoProfile: "INDEPENDENT_GRADE_READY",
            wordRecognitionLevel: "LEVEL_5",
            readingComprehensionLevel: "LEVEL_3",
            complete: true,
          },
        }),
        learner({
          id: "partial-1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: "INSTRUCTIONAL_DEVELOPING",
            filipinoProfile: null,
            wordRecognitionLevel: null,
            readingComprehensionLevel: null,
            complete: false,
          },
        }),
        learner({
          id: "unassessed-1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          record: null,
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const detail = findBlock(blocks, "Learner Detail");
    const statusIdx = detail.columns.map((c) => c.header).indexOf("Assessment Status");
    expect(detail.rows[0]![statusIdx]).toBe("Complete");
    expect(detail.rows[1]![statusIdx]).toBe("Partial");
    expect(detail.rows[2]![statusIdx]).toBe("Not assessed");
  });
});

describe("buildMosyBlocks — names", () => {
  it("renders surname-first, with and without a middle name", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G3],
      learners: [
        learner({
          id: "with-middle",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          firstName: "Juan",
          middleName: "Miguel",
          lastName: "Dela Cruz",
        }),
        learner({
          id: "no-middle",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          firstName: "Ana",
          middleName: null,
          lastName: "Reyes",
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const detail = findBlock(blocks, "Learner Detail");
    const learnerIdx = detail.columns.map((c) => c.header).indexOf("Learner");
    expect(detail.rows[0]![learnerIdx]).toBe("Dela Cruz, Juan Miguel");
    expect(detail.rows[1]![learnerIdx]).toBe("Reyes, Ana");
  });
});

describe("buildMosyBlocks — ARAL profiling modal intervention", () => {
  it("is deterministic on a tie: same input yields the same output twice", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G3],
      learners: [
        learner({
          id: "a1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: { updatedAtKey: "2026-11-05", interventions: ["ONE_ON_ONE"] },
        }),
        learner({
          id: "a2",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: { updatedAtKey: "2026-11-12", interventions: ["PHONEMIC_AWARENESS"] },
        }),
      ],
    };
    const runOnce = () => {
      const blocks = buildMosyBlocks(input);
      const aral = findBlock(blocks, "ARAL Profiling");
      const idx = aral.columns.map((c) => c.header).indexOf("Most Suggested Intervention");
      return aral.rows[0]![idx];
    };
    const first = runOnce();
    const second = runOnce();
    expect(first).toBe(second);
    // Both interventions tie at one profile each; the tiebreak favours
    // whichever key appears first in `INTERVENTION_LABELS`'s declaration
    // order, which lists PHONEMIC_AWARENESS before ONE_ON_ONE.
    expect(first).toBe("Phonemic awareness activities");
  });

  it("reports the max updatedAtKey and an em-dash-equivalent null when there are no profiles", () => {
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [G3],
      learners: [
        learner({
          id: "a1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: { updatedAtKey: "2026-11-05", interventions: [] },
        }),
        learner({
          id: "a2",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          isAralLearner: true,
          profile: { updatedAtKey: "2026-12-20", interventions: [] },
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const aral = findBlock(blocks, "ARAL Profiling");
    const headers = aral.columns.map((c) => c.header);
    expect(aral.rows[0]![headers.indexOf("Last Profile Updated")]).toBe("2026-12-20");
    expect(aral.rows[0]![headers.indexOf("Most Suggested Intervention")]).toBeNull();
  });
});

describe("buildMosyBlocks — off-rubric stale values do not break row reconciliation", () => {
  it("excludes a value not on the grade's rubric from Assessed, so the band columns sum to it", () => {
    // A G3 learner carrying a stale Kinder-rubric value ("Letter Level" is
    // Kinder-only per `allowedReadingValuesForGrade`) — e.g. a promoted
    // learner whose record was never re-assessed under the new grade.
    const input: MosyInput = {
      window: RESOLVED_WINDOW,
      grades: [KINDER, G3],
      learners: [
        learner({
          id: "g3-1",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: null,
            filipinoProfile: "INDEPENDENT_GRADE_READY",
            wordRecognitionLevel: "LEVEL_4",
            readingComprehensionLevel: "LEVEL_3",
            complete: true,
          },
        }),
        learner({
          id: "g3-2-stale",
          gradeLevelId: G3.id,
          gradeType: G3.type,
          gradeLabel: G3.label,
          record: {
            weekStartKey: "2026-11-10",
            englishProfile: null,
            // Off G3's rubric entirely — has no band column on this row.
            filipinoProfile: "LETTER_LEVEL",
            wordRecognitionLevel: "LEVEL_1",
            readingComprehensionLevel: "LEVEL_1",
            complete: true,
          },
        }),
      ],
    };
    const blocks = buildMosyBlocks(input);
    const filipino = findBlock(blocks, "Reading Level Profile per Grade Level (Filipino)");
    const headers = filipino.columns.map((c) => c.header);
    const g3RowIdx = filipino.rows.findIndex((r) => r[0] === G3.label);
    const g3Row = filipino.rows[g3RowIdx]!;

    const assessedIdx = headers.indexOf("Assessed");
    // The stale off-rubric value is excluded: only the one genuinely-rubric
    // assessment counts, not both.
    expect(g3Row[assessedIdx]).toBe(1);

    // Every band column sums exactly to Assessed — a reader can add across
    // the row. The band columns start after "Coverage %" and stop before
    // "Average Level" (the last column).
    const bandStart = headers.indexOf("Coverage %") + 1;
    const bandEnd = headers.length - 1;
    const bandSum = g3Row
      .slice(bandStart, bandEnd)
      .reduce((sum: number, v) => sum + (typeof v === "number" ? v : 0), 0);
    expect(bandSum).toBe(g3Row[assessedIdx]);
  });
});

describe("buildMosyBlocks — reconciliation across a mixed two-grade fixture", () => {
  const learners: MosyLearner[] = [
    learner({
      id: "k1",
      gradeLevelId: KINDER.id,
      gradeType: KINDER.type,
      gradeLabel: KINDER.label,
      isAralLearner: false,
      record: {
        weekStartKey: "2026-11-10",
        englishProfile: "CV_BLENDING",
        filipinoProfile: "CV_BLENDING",
        wordRecognitionLevel: "LEVEL_2",
        readingComprehensionLevel: "LEVEL_1",
        complete: true,
      },
    }),
    learner({
      id: "k2",
      gradeLevelId: KINDER.id,
      gradeType: KINDER.type,
      gradeLabel: KINDER.label,
      isAralLearner: true,
      aralTutorName: "T. Santos",
      record: null,
      profile: { updatedAtKey: "2026-11-01", interventions: ["HOME_READING"] },
    }),
    learner({
      id: "g3-1",
      gradeLevelId: G3.id,
      gradeType: G3.type,
      gradeLabel: G3.label,
      isAralLearner: true,
      aralTutorName: "T. Cruz",
      record: {
        weekStartKey: "2026-11-15",
        englishProfile: "INSTRUCTIONAL_DEVELOPING",
        filipinoProfile: "INSTRUCTIONAL_DEVELOPING",
        wordRecognitionLevel: "LEVEL_3",
        readingComprehensionLevel: "LEVEL_2",
        complete: true,
      },
      profile: null,
    }),
  ];
  const input: MosyInput = { window: RESOLVED_WINDOW, grades: [KINDER, G3], learners };

  it("block 1/2/3 grade totals equal block 4's per-grade row counts", () => {
    const blocks = buildMosyBlocks(input);
    const detail = findBlock(blocks, "Learner Detail");
    expect(detail.rows).toHaveLength(3);

    const english = findBlock(blocks, "Reading Level Profile per Grade Level (English)");
    const aral = findBlock(blocks, "ARAL Profiling");

    const kinderDetailCount = detail.rows.filter((r) => r[2] === KINDER.label).length;
    const g3DetailCount = detail.rows.filter((r) => r[2] === G3.label).length;

    expect(english.rows[0]![1]).toBe(kinderDetailCount); // Kinder Learners
    expect(english.rows[1]![1]).toBe(g3DetailCount); // Grade 3 Learners

    const kinderAralDetailCount = detail.rows.filter(
      (r) => r[2] === KINDER.label && r[4] === "Yes"
    ).length;
    const g3AralDetailCount = detail.rows.filter(
      (r) => r[2] === G3.label && r[4] === "Yes"
    ).length;
    expect(aral.rows[0]![1]).toBe(kinderAralDetailCount); // Kinder ARAL Learners
    expect(aral.rows[1]![1]).toBe(g3AralDetailCount); // Grade 3 ARAL Learners
  });
});

describe("describeMosyWindowNote", () => {
  it("is null for a resolved term window", () => {
    expect(describeMosyWindowNote(RESOLVED_WINDOW)).toBeNull();
  });

  it("surfaces a note for an unresolved window", () => {
    expect(
      describeMosyWindowNote({ ...RESOLVED_WINDOW, source: "unresolved" })
    ).toEqual(expect.stringContaining("could not"));
  });

  it("surfaces a note for a custom override window", () => {
    expect(describeMosyWindowNote({ ...RESOLVED_WINDOW, source: "custom" })).toEqual(
      expect.stringContaining("override")
    );
  });
});
