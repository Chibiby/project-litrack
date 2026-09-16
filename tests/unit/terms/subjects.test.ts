import { describe, expect, it } from "vitest";
import { LEARNING_AREA_LABELS, LEARNING_AREA_ORDER } from "@/lib/constants/enum-labels";
import { isKinderGradeType } from "@/lib/terms/kinder-competencies";
import {
  DEFAULT_TERM_SUBJECTS,
  isValidSubjectName,
  KINDER_GRADE_MESSAGE,
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  nextPosition,
  orderSheetSubjects,
  planSubjectReorder,
  planSubjectReset,
  subjectNameKey,
  TERM_SHEET_GRADE_TYPES,
} from "@/lib/terms/subjects";

/**
 * Pure-module coverage for `src/lib/terms/subjects.ts` — no Prisma, no server
 * boundary. Every check here must fail if its guard were deleted: this is the
 * module the School Head subject sheet, the save action and the reports
 * grouping all lean on for "what order is this sheet in" and "is this a legal
 * reorder".
 */

describe("DEFAULT_TERM_SUBJECTS", () => {
  it("has exactly 8 rows, positions 0-7, matching LEARNING_AREA_ORDER", () => {
    expect(DEFAULT_TERM_SUBJECTS).toHaveLength(8);
    expect(DEFAULT_TERM_SUBJECTS.map((d) => d.legacyArea)).toEqual([
      ...LEARNING_AREA_ORDER,
    ]);
    expect(DEFAULT_TERM_SUBJECTS.map((d) => d.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("names every row exactly LEARNING_AREA_LABELS — the M1 migration's seed must match", () => {
    // If this drifts, the lazy seed (getSheetSubjects) and the SQL seed in
    // 20260915000001_term_subject_table produce two different sets of subject
    // names for the same grade, and the backfill join key breaks.
    for (const d of DEFAULT_TERM_SUBJECTS) {
      expect(d.name).toBe(LEARNING_AREA_LABELS[d.legacyArea]);
    }
  });
});

describe("subjectNameKey", () => {
  it("trims and lowercases — the key the active-name unique index compares on", () => {
    expect(subjectNameKey("  English  ")).toBe("english");
    expect(subjectNameKey("MATHEMATICS")).toBe("mathematics");
    expect(subjectNameKey("Araling Panlipunan")).toBe("araling panlipunan");
  });

  it("makes two differently-cased/whitespaced names collide", () => {
    expect(subjectNameKey("English")).toBe(subjectNameKey(" english "));
  });

  it("does not collapse internal whitespace, only trim the ends", () => {
    expect(subjectNameKey("Araling  Panlipunan")).toBe("araling  panlipunan");
  });
});

describe("orderSheetSubjects", () => {
  const row = (
    id: string,
    name: string,
    position: number,
    deletedAt: Date | null = null
  ) => ({ id, name, position, deletedAt });

  it("orders by position", () => {
    const rows = [row("c", "Science", 2), row("a", "English", 0), row("b", "Filipino", 1)];
    expect(orderSheetSubjects(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a position tie by name", () => {
    const rows = [row("z", "Zoology", 0), row("a", "Art", 0)];
    expect(orderSheetSubjects(rows).map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("breaks a position AND name tie by id", () => {
    const rows = [row("z-id", "Same", 0), row("a-id", "Same", 0)];
    expect(orderSheetSubjects(rows).map((r) => r.id)).toEqual(["a-id", "z-id"]);
  });

  it("drops archived rows entirely — they must never reach the sheet, export or reports", () => {
    const rows = [
      row("a", "English", 0),
      row("b", "Filipino", 1, new Date(2026, 8, 1)),
    ];
    const result = orderSheetSubjects(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("never mutates the input array", () => {
    const rows = [row("b", "B", 1), row("a", "A", 0)];
    const original = [...rows];
    orderSheetSubjects(rows);
    expect(rows).toEqual(original);
  });

  it("returns an empty list when every row is archived", () => {
    const rows = [row("a", "A", 0, new Date()), row("b", "B", 1, new Date())];
    expect(orderSheetSubjects(rows)).toEqual([]);
  });
});

describe("nextPosition", () => {
  it("is 0 when there are no rows at all", () => {
    expect(nextPosition([])).toBe(0);
  });

  it("is 0 when every row is archived", () => {
    expect(
      nextPosition([
        { position: 5, deletedAt: new Date() },
        { position: 3, deletedAt: new Date() },
      ])
    ).toBe(0);
  });

  it("is one past the highest ACTIVE position, ignoring archived rows with a higher one", () => {
    expect(
      nextPosition([
        { position: 0, deletedAt: null },
        { position: 1, deletedAt: null },
        { position: 99, deletedAt: new Date() },
      ])
    ).toBe(2);
  });

  it("handles a gappy position sequence by taking the max, not the count", () => {
    expect(
      nextPosition([
        { position: 0, deletedAt: null },
        { position: 7, deletedAt: null },
      ])
    ).toBe(8);
  });
});

describe("MAX_ACTIVE_SUBJECTS_PER_GRADE", () => {
  it("is 15", () => {
    expect(MAX_ACTIVE_SUBJECTS_PER_GRADE).toBe(15);
  });
});

describe("planSubjectReorder", () => {
  it("plans positions 0..n-1 in the requested order for a true permutation", () => {
    const plan = planSubjectReorder(["a", "b", "c"], ["c", "a", "b"]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: "c", position: 0 },
        { id: "a", position: 1 },
        { id: "b", position: 2 },
      ],
    });
  });

  it("accepts the identity permutation", () => {
    const plan = planSubjectReorder(["a", "b"], ["a", "b"]);
    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: "a", position: 0 },
        { id: "b", position: 1 },
      ],
    });
  });

  it("is STALE when an id present in requestedIds is missing from activeIds (archived or unknown)", () => {
    expect(planSubjectReorder(["a", "b"], ["a", "b", "c"])).toEqual({
      ok: false,
      reason: "STALE",
    });
  });

  it("is STALE when an active id is missing from the request (client's list is out of date)", () => {
    expect(planSubjectReorder(["a", "b", "c"], ["a", "b"])).toEqual({
      ok: false,
      reason: "STALE",
    });
  });

  it("is DUPLICATE when the same id repeats in the request, even if the set matches", () => {
    // Set-equality alone would treat ["a","a","b"] as legal against ["a","b"];
    // must be checked before the STALE comparison.
    expect(planSubjectReorder(["a", "b"], ["a", "a"])).toEqual({
      ok: false,
      reason: "DUPLICATE",
    });
  });

  it("prefers DUPLICATE over STALE when both conditions could apply", () => {
    // ["a","a","z"] is both a duplicate AND contains an unknown id "z" — the
    // duplicate check runs first.
    expect(planSubjectReorder(["a", "b"], ["a", "a", "z"])).toEqual({
      ok: false,
      reason: "DUPLICATE",
    });
  });

  it("is STALE for an empty request against a non-empty active list", () => {
    expect(planSubjectReorder(["a"], [])).toEqual({ ok: false, reason: "STALE" });
  });

  it("accepts two empty lists", () => {
    expect(planSubjectReorder([], [])).toEqual({ ok: true, updates: [] });
  });
});

describe("isValidSubjectName — the one character rule", () => {
  it("rejects every C0 control code point, 0 through 31", () => {
    expect(isValidSubjectName("Read\x00ing")).toBe(false);
    expect(isValidSubjectName("Read\x1Fing")).toBe(false);
  });

  it("accepts the boundary right above C0: U+0020 (space)", () => {
    expect(isValidSubjectName("Reading Club")).toBe(true);
  });

  it("rejects DEL (U+007F) but accepts the code point just below and above it", () => {
    expect(isValidSubjectName("Read\x7Fing")).toBe(false);
    expect(isValidSubjectName("Read\x7Eing")).toBe(true); // U+007E "~"
    expect(isValidSubjectName("Read\x80ing")).toBe(true); // U+0080, not DEL
  });

  it("accepts an empty string — blank/length rules live in the Zod schema, not here", () => {
    expect(isValidSubjectName("")).toBe(true);
  });
});

describe("TERM_SHEET_GRADE_TYPES", () => {
  it("excludes FLOATING — the one GradeLevelType with no End of Terms sheet", () => {
    expect(TERM_SHEET_GRADE_TYPES).not.toContain("FLOATING");
  });

  it("excludes KINDER — Kindergarten's report is the fixed competency checklist, not configurable subjects", () => {
    // Regression guard: a future change that re-offers Kindergarten subjects
    // must fail here, not just in the UI. Checked through the single
    // Kindergarten predicate, not a second hardcoded "KINDER" comparison.
    expect(TERM_SHEET_GRADE_TYPES.some(isKinderGradeType)).toBe(false);
    expect(TERM_SHEET_GRADE_TYPES).not.toContain("KINDER");
  });

  it("is exactly G1 through G12, in enum declaration order", () => {
    expect(TERM_SHEET_GRADE_TYPES).toEqual([
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
      "G8",
      "G9",
      "G10",
      "G11",
      "G12",
    ]);
  });
});

describe("KINDER_GRADE_MESSAGE", () => {
  it("is a non-empty, user-safe sentence distinct from FLOATING_GRADE_MESSAGE", () => {
    expect(KINDER_GRADE_MESSAGE.length).toBeGreaterThan(0);
    expect(KINDER_GRADE_MESSAGE).toContain("competency checklist");
  });
});

describe("planSubjectReset", () => {
  const active = (id: string, name: string): { id: string; name: string; deletedAt: Date | null } => ({
    id,
    name,
    deletedAt: null,
  });
  const archived = (id: string, name: string): { id: string; name: string; deletedAt: Date | null } => ({
    id,
    name,
    deletedAt: new Date(2026, 8, 1),
  });

  it("matches an existing row to a default by name key — case- and whitespace-insensitive", () => {
    const plan = planSubjectReset(
      [{ name: "English" }],
      [active("row-1", "  ENGLISH  ")]
    );
    expect(plan).toEqual({
      toRestore: [],
      toReposition: [{ id: "row-1", position: 0 }],
      toCreate: [],
      toArchive: [],
    });
  });

  it("prefers an ACTIVE match over an ARCHIVED match with the same name", () => {
    const plan = planSubjectReset(
      [{ name: "English" }],
      [archived("archived-english", "English"), active("active-english", "English")]
    );
    expect(plan.toReposition).toEqual([{ id: "active-english", position: 0 }]);
    expect(plan.toRestore).toEqual([]);
  });

  it("restores an archived row when no active row shares its name", () => {
    const plan = planSubjectReset(
      [{ name: "English" }],
      [archived("archived-english", "English")]
    );
    expect(plan.toRestore).toEqual([{ id: "archived-english", position: 0 }]);
    expect(plan.toReposition).toEqual([]);
  });

  it("creates a default that matches no existing row at all, active or archived", () => {
    const plan = planSubjectReset([{ name: "Science" }], []);
    expect(plan.toCreate).toEqual([{ name: "Science", position: 0 }]);
  });

  it("archives an active row matching no default", () => {
    const plan = planSubjectReset([], [active("stray", "Custom Subject")]);
    expect(plan.toArchive).toEqual(["stray"]);
  });

  it("leaves an already-archived row matching no default untouched", () => {
    const plan = planSubjectReset([], [archived("stray-archived", "Old Custom")]);
    expect(plan.toArchive).toEqual([]);
    expect(plan.toRestore).toEqual([]);
    expect(plan.toReposition).toEqual([]);
  });

  it("positions every matched or created row at the default's own index", () => {
    const plan = planSubjectReset(
      [{ name: "English" }, { name: "Filipino" }, { name: "Science" }],
      [active("row-filipino", "Filipino")]
    );
    expect(plan.toCreate).toEqual([
      { name: "English", position: 0 },
      { name: "Science", position: 2 },
    ]);
    expect(plan.toReposition).toEqual([{ id: "row-filipino", position: 1 }]);
  });

  it("a full round trip: reposition, restore, create and archive together", () => {
    const plan = planSubjectReset(
      [{ name: "English" }, { name: "Science" }],
      [
        active("active-english", "English"),
        archived("archived-science", "Science"),
        active("stray-custom", "Custom Subject"),
      ]
    );
    expect(plan).toEqual({
      toRestore: [{ id: "archived-science", position: 1 }],
      toReposition: [{ id: "active-english", position: 0 }],
      toCreate: [],
      toArchive: ["stray-custom"],
    });
  });
});
