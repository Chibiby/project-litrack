import { describe, expect, it } from "vitest";
import {
  computeSheetStats,
  sliceSheetPage,
  subjectAbbreviation,
  subjectWindow,
} from "@/lib/terms/sheet-view";

describe("computeSheetStats", () => {
  const subjectIdsByGrade = new Map([
    ["g3", ["eng", "fil"]],
    ["g4", ["eng4", "fil4", "sci4"]],
  ]);

  it("counts a learner complete only when every subject of their grade has a score", () => {
    const stats = computeSheetStats({
      learners: [
        { id: "a", gradeLevelId: "g3" },
        { id: "b", gradeLevelId: "g3" },
        { id: "c", gradeLevelId: "g4" },
      ],
      subjectIdsByGrade,
      gradeTypeByGrade: new Map(),
      scores: [
        { learnerId: "a", termSubjectId: "eng", score: 80 },
        { learnerId: "a", termSubjectId: "fil", score: 90 },
        { learnerId: "b", termSubjectId: "eng", score: 70 },
        // c holds two of its grade's three subjects: not complete.
        { learnerId: "c", termSubjectId: "eng4", score: 99 },
        { learnerId: "c", termSubjectId: "fil4", score: 99 },
      ],
    });
    expect(stats).toEqual({ total: 3, complete: 1, completionPct: 33, classAverage: 85 });
  });

  it("averages the complete learners' general averages across grades", () => {
    const stats = computeSheetStats({
      learners: [
        { id: "a", gradeLevelId: "g3" },
        { id: "c", gradeLevelId: "g4" },
      ],
      subjectIdsByGrade,
      gradeTypeByGrade: new Map(),
      scores: [
        { learnerId: "a", termSubjectId: "eng", score: 80 },
        { learnerId: "a", termSubjectId: "fil", score: 90 },
        { learnerId: "c", termSubjectId: "eng4", score: 75 },
        { learnerId: "c", termSubjectId: "fil4", score: 76 },
        { learnerId: "c", termSubjectId: "sci4", score: 77 },
      ],
    });
    // (85 + 76) / 2
    expect(stats.classAverage).toBe(80.5);
    expect(stats.completionPct).toBe(100);
  });

  it("ignores scores for subjects no longer on the sheet", () => {
    const stats = computeSheetStats({
      learners: [{ id: "a", gradeLevelId: "g3" }],
      subjectIdsByGrade,
      gradeTypeByGrade: new Map(),
      scores: [
        { learnerId: "a", termSubjectId: "eng", score: 80 },
        { learnerId: "a", termSubjectId: "archived", score: 60 },
        { learnerId: "a", termSubjectId: null, score: 60 },
      ],
    });
    expect(stats.complete).toBe(0);
  });

  it("never counts a grade with no subjects as complete", () => {
    const stats = computeSheetStats({
      learners: [{ id: "k", gradeLevelId: "gk" }],
      subjectIdsByGrade,
      gradeTypeByGrade: new Map(),
      scores: [],
    });
    expect(stats).toEqual({ total: 1, complete: 0, completionPct: 0, classAverage: null });
  });

  it("reports zeros and no average for an empty scope", () => {
    expect(
      computeSheetStats({
        learners: [],
        subjectIdsByGrade,
        gradeTypeByGrade: new Map(),
        scores: [],
      })
    ).toEqual({ total: 0, complete: 0, completionPct: 0, classAverage: null });
  });

  describe("Grade 1 (letter marks) via gradeTypeByGrade", () => {
    const g1SubjectIdsByGrade = new Map([
      ["g1", ["eng1"]],
      ["g3", ["eng3", "fil3"]],
    ]);
    const gradeTypeByGrade = new Map([
      ["g1", "G1"],
      ["g3", "G3"],
    ]);

    it("counts a G1 learner whose cells are marks as complete", () => {
      const stats = computeSheetStats({
        learners: [{ id: "a", gradeLevelId: "g1" }],
        subjectIdsByGrade: g1SubjectIdsByGrade,
        gradeTypeByGrade,
        scores: [{ learnerId: "a", termSubjectId: "eng1", score: null, mark: "ADVANCING" }],
      });
      expect(stats.complete).toBe(1);
      expect(stats.completionPct).toBe(100);
    });

    it("excludes G1 learners from the class average even though they count as complete", () => {
      const stats = computeSheetStats({
        learners: [
          { id: "a", gradeLevelId: "g1" },
          { id: "b", gradeLevelId: "g3" },
        ],
        subjectIdsByGrade: g1SubjectIdsByGrade,
        gradeTypeByGrade,
        scores: [
          { learnerId: "a", termSubjectId: "eng1", score: null, mark: "ADVANCING" },
          { learnerId: "b", termSubjectId: "eng3", score: 80, mark: null },
          { learnerId: "b", termSubjectId: "fil3", score: 90, mark: null },
        ],
      });
      expect(stats.complete).toBe(2);
      // Only b's (80+90)/2 = 85 counts; a's LETTER-scale row is excluded entirely.
      expect(stats.classAverage).toBe(85);
    });

    it("treats a grade missing from gradeTypeByGrade as numeric", () => {
      const stats = computeSheetStats({
        learners: [{ id: "a", gradeLevelId: "g3" }],
        subjectIdsByGrade: g1SubjectIdsByGrade,
        // An empty scale map: every grade falls back to "", which
        // termGradingScale treats as NUMERIC.
        gradeTypeByGrade: new Map(),
        scores: [
          { learnerId: "a", termSubjectId: "eng3", score: 80, mark: null },
          { learnerId: "a", termSubjectId: "fil3", score: 90, mark: null },
        ],
      });
      expect(stats.classAverage).toBe(85);
    });
  });
});

describe("sliceSheetPage", () => {
  const sections = [
    { key: "atis", count: 4 },
    { key: "mabolo", count: 3 },
    { key: "rosal", count: 5 },
  ];

  it("takes the first section whole when it fills the page", () => {
    expect(sliceSheetPage(sections, 1, 4)).toEqual([
      { key: "atis", skip: 0, take: 4, offset: 0 },
    ]);
  });

  it("spans a section boundary", () => {
    expect(sliceSheetPage(sections, 1, 6)).toEqual([
      { key: "atis", skip: 0, take: 4, offset: 0 },
      { key: "mabolo", skip: 0, take: 2, offset: 4 },
    ]);
    expect(sliceSheetPage(sections, 2, 6)).toEqual([
      { key: "mabolo", skip: 2, take: 1, offset: 6 },
      { key: "rosal", skip: 0, take: 5, offset: 7 },
    ]);
  });

  it("skips empty sections and returns nothing past the end", () => {
    expect(sliceSheetPage([{ key: "a", count: 0 }, { key: "b", count: 2 }], 1, 10)).toEqual([
      { key: "b", skip: 0, take: 2, offset: 0 },
    ]);
    expect(sliceSheetPage(sections, 9, 10)).toEqual([]);
  });
});

describe("subjectAbbreviation", () => {
  it("uses the mockup's labels for DepEd subjects, whatever the casing", () => {
    expect(subjectAbbreviation("English")).toBe("ENG");
    expect(subjectAbbreviation("FILIPINO")).toBe("FIL");
    expect(subjectAbbreviation("Mathematics")).toBe("MATH");
    expect(subjectAbbreviation("Science")).toBe("SCI");
    expect(subjectAbbreviation("Araling  Panlipunan")).toBe("AP");
    expect(subjectAbbreviation("Edukasyon sa Pagpapakatao")).toBe("ESP");
  });

  it("derives a label for a School Head's own subject names", () => {
    expect(subjectAbbreviation("MAPEH")).toBe("MAPEH");
    expect(subjectAbbreviation("TLE")).toBe("TLE");
    expect(subjectAbbreviation("Journalism")).toBe("JOUR");
    expect(subjectAbbreviation("Music and Arts")).toBe("MA");
  });
});

describe("subjectWindow", () => {
  it("shows five subjects at a time and wraps", () => {
    expect(subjectWindow(8, 0)).toEqual({ start: 0, end: 5, windows: 2 });
    expect(subjectWindow(8, 1)).toEqual({ start: 5, end: 8, windows: 2 });
    expect(subjectWindow(8, 2)).toEqual({ start: 0, end: 5, windows: 2 });
  });

  it("clamps per list, so a shorter grade stays on its only window", () => {
    expect(subjectWindow(4, 1)).toEqual({ start: 0, end: 4, windows: 1 });
    expect(subjectWindow(0, 3)).toEqual({ start: 0, end: 0, windows: 1 });
  });
});
