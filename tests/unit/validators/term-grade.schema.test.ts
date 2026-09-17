import { describe, expect, it } from "vitest";
import {
  termGradesSaveSchema,
  termGradesExportSchema,
} from "@/lib/validators/term-grade.schema";

/**
 * The score range is 60-100 by explicit decision: 75 is DepEd's *passing* mark,
 * not its floor, and a 75 floor would make a failing learner unrecordable and
 * push teachers into entering a false 75. These tests pin the exact boundaries so
 * a later "tidy-up" to 75 fails loudly instead of silently.
 *
 * Subjects are posted by `termSubjectId` — the School Head-managed `TermSubject`
 * row id — not the old `LearningArea` enum. The schema only asserts shape; the
 * server re-checks every id against the grade's active list
 * (docs/superpowers/specs/2026-09-14-term-subjects-management-design.md §5, §7).
 */

const TERMS = ["FIRST", "SECOND", "THIRD"] as const;

const validEntry = {
  learnerId: "learner-1",
  termSubjectId: "subject-english",
  score: 90,
};

const validSave = {
  gradeLevelId: "gl-7",
  term: "FIRST" as const,
  entries: [validEntry],
};

/** One save payload carrying a single score. */
function withScore(score: number | null) {
  return { ...validSave, entries: [{ ...validEntry, score }] };
}

describe("termGradesSaveSchema", () => {
  it("accepts a valid payload", () => {
    const result = termGradesSaveSchema.safeParse(validSave);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.entries[0].score).toBe(90);
    expect(result.data.entries[0].termSubjectId).toBe("subject-english");
    expect(result.data.term).toBe("FIRST");
  });

  it("enforces the score floor at 60, not DepEd's 75 passing mark", () => {
    expect(termGradesSaveSchema.safeParse(withScore(59)).success).toBe(false);
    expect(termGradesSaveSchema.safeParse(withScore(60)).success).toBe(true);
    // A failing learner must be recordable: everything between 60 and 75 is valid.
    expect(termGradesSaveSchema.safeParse(withScore(61)).success).toBe(true);
    expect(termGradesSaveSchema.safeParse(withScore(74)).success).toBe(true);
  });

  it("enforces the score ceiling at 100", () => {
    expect(termGradesSaveSchema.safeParse(withScore(100)).success).toBe(true);
    expect(termGradesSaveSchema.safeParse(withScore(101)).success).toBe(false);
  });

  it("accepts a null score — a cleared cell", () => {
    const result = termGradesSaveSchema.safeParse(withScore(null));
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Null must survive parsing: the action deletes the row for a cleared cell,
    // and coercing null to 0 here would write an out-of-range score instead.
    expect(result.data.entries[0].score).toBeNull();
  });

  it("rejects a non-integer score", () => {
    // DepEd quarterly grades are whole numbers, and the column is an Int.
    expect(termGradesSaveSchema.safeParse(withScore(85.5)).success).toBe(false);
    expect(termGradesSaveSchema.safeParse(withScore(99.999)).success).toBe(false);
  });

  it("accepts any non-blank termSubjectId string — the server re-checks it against the sheet", () => {
    // The schema only asserts shape now: subjects are School Head-managed rows,
    // not a fixed enum, so the set of legal ids cannot be known statically.
    for (const termSubjectId of ["subject-english", "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "x"]) {
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, termSubjectId }],
      });
      expect(result.success, `${termSubjectId} should be accepted`).toBe(true);
    }
  });

  it("rejects a blank or missing termSubjectId", () => {
    expect(
      termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, termSubjectId: "" }],
      }).success
    ).toBe(false);
    const { termSubjectId: _drop, ...withoutSubject } = validEntry;
    expect(
      termGradesSaveSchema.safeParse({ ...validSave, entries: [withoutSubject] }).success
    ).toBe(false);
  });

  it("no longer accepts the old subject enum key at all — subject is not a recognised field", () => {
    // A stale client posting the pre-migration shape (`subject: "ENGLISH"`
    // instead of `termSubjectId`) must fail validation, not silently pass
    // through as an entry with no subject.
    const legacyShaped = {
      ...validSave,
      entries: [{ learnerId: "learner-1", subject: "ENGLISH", score: 90 }],
    };
    expect(termGradesSaveSchema.safeParse(legacyShaped).success).toBe(false);
  });

  it("accepts the three terms and rejects anything else", () => {
    for (const term of TERMS) {
      expect(termGradesSaveSchema.safeParse({ ...validSave, term }).success).toBe(true);
    }

    for (const term of ["FOURTH", "QUARTER_1", "first", ""]) {
      const result = termGradesSaveSchema.safeParse({ ...validSave, term });
      expect(result.success, `${term} should be rejected`).toBe(false);
    }
  });

  it("rejects an empty entries array", () => {
    // An empty batch would produce an audit row claiming a save that wrote
    // nothing; the grid only posts changed cells, so empty means a client bug.
    expect(termGradesSaveSchema.safeParse({ ...validSave, entries: [] }).success).toBe(
      false
    );
  });

  it("requires gradeLevelId, term and entries", () => {
    expect(
      termGradesSaveSchema.safeParse({ term: "FIRST", entries: [validEntry] }).success
    ).toBe(false);
    expect(
      termGradesSaveSchema.safeParse({ gradeLevelId: "gl-7", entries: [validEntry] })
        .success
    ).toBe(false);
    expect(
      termGradesSaveSchema.safeParse({ gradeLevelId: "gl-7", term: "FIRST" }).success
    ).toBe(false);
  });

  it("rejects blank ids", () => {
    expect(termGradesSaveSchema.safeParse({ ...validSave, gradeLevelId: "" }).success).toBe(
      false
    );
    expect(
      termGradesSaveSchema.safeParse({
        ...validSave,
        entries: [{ ...validEntry, learnerId: "" }],
      }).success
    ).toBe(false);
  });

  describe("the 1500-entry cap", () => {
    // 100 learners x 15 subjects (the per-grade cap, MAX_ACTIVE_SUBJECTS_PER_GRADE)
    // = 1500 — the worst legitimate payload is one full page re-typed at the new,
    // higher per-grade subject cap. The old ceiling was 1000 (100 x the fixed 8
    // learning areas); this pins the new one explicitly so a partial rebase of
    // the schema cannot silently leave it at the old value.
    function entriesOfLength(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        learnerId: `learner-${i}`,
        termSubjectId: "subject-english",
        score: 87,
      }));
    }

    it("accepts exactly 1500 entries", () => {
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: entriesOfLength(1500),
      });
      expect(result.success).toBe(true);
    });

    it("rejects 1501 entries", () => {
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: entriesOfLength(1501),
      });
      expect(result.success).toBe(false);
    });

    it("rejects the old 1000-entry payload no more strictly than 1500 does — 1200 is now legal", () => {
      // Guards against the cap having been left at 1000 by mistake: a batch this
      // shape must be ACCEPTED under the new limit.
      const result = termGradesSaveSchema.safeParse({
        ...validSave,
        entries: entriesOfLength(1200),
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("termGradesSaveSchema — Grade 1 letter marks", () => {
  // A cell carries EITHER a score OR a mark, never both — enforced by the
  // `.refine` — and "neither" is the legacy clear. Which grade may post which
  // kind is a server-side decision (`termGradingScale`), not asserted here;
  // the schema only asserts shape.
  function withEntry(entry: Record<string, unknown>) {
    const { score: _s, ...rest } = validEntry;
    return { ...validSave, entries: [{ ...rest, ...entry }] };
  }

  it("accepts a mark-only cell", () => {
    const result = termGradesSaveSchema.safeParse(withEntry({ mark: "BENCHMARKING" }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries[0].mark).toBe("BENCHMARKING");
    expect(result.data.entries[0].score).toBeUndefined();
  });

  it("accepts every TermMark value", () => {
    for (const mark of ["ADVANCING", "BENCHMARKING", "CONNECTING", "DEVELOPING", "EMERGING"]) {
      expect(termGradesSaveSchema.safeParse(withEntry({ mark })).success, mark).toBe(true);
    }
  });

  it("accepts { score: null } as the legacy clear payload", () => {
    const result = termGradesSaveSchema.safeParse(withEntry({ score: null }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries[0].score).toBeNull();
  });

  it("accepts a cell with neither score nor mark set", () => {
    const result = termGradesSaveSchema.safeParse(withEntry({}));
    expect(result.success).toBe(true);
  });

  it("rejects a cell carrying both a score and a mark", () => {
    const result = termGradesSaveSchema.safeParse(
      withEntry({ score: 90, mark: "ADVANCING" })
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised mark value", () => {
    const result = termGradesSaveSchema.safeParse(withEntry({ mark: "X" }));
    expect(result.success).toBe(false);
  });

  it("still enforces the score floor at 60 when a score is posted instead of a mark", () => {
    expect(termGradesSaveSchema.safeParse(withEntry({ score: 59 })).success).toBe(false);
  });
});

describe("termGradesExportSchema", () => {
  it("accepts input with section and q omitted", () => {
    // Export from an unfiltered, unsearched sheet — the common case.
    const result = termGradesExportSchema.safeParse({
      gradeLevelId: "gl-7",
      term: "FIRST",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.section).toBeUndefined();
    expect(result.data.q).toBeUndefined();
  });

  it("accepts a section filter and a search term", () => {
    const result = termGradesExportSchema.safeParse({
      gradeLevelId: "gl-7",
      term: "THIRD",
      section: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      q: "santos",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown term and a missing gradeLevelId", () => {
    expect(
      termGradesExportSchema.safeParse({ gradeLevelId: "gl-7", term: "FOURTH" }).success
    ).toBe(false);
    expect(termGradesExportSchema.safeParse({ term: "FIRST" }).success).toBe(false);
  });
});
