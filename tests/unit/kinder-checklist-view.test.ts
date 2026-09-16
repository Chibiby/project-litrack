import { describe, expect, it } from "vitest";
import {
  countTouchedCompetencies,
  mergeKinderChecklist,
  splitByKinderGradeType,
  type KinderChecklistCellState,
} from "@/lib/terms/kinder-checklist-view";
import {
  KINDER_COMPETENCY_COUNT,
  KINDER_COMPETENCY_ENTRIES_IN_ORDER,
  type KinderCompetencyKey,
} from "@/lib/terms/kinder-competencies";

function emptyCell(): KinderChecklistCellState {
  return { t1Rating: null, t2Rating: null, t3Rating: null, remark: null };
}

describe("mergeKinderChecklist", () => {
  it("returns one entry per catalog key, even when nothing was saved", () => {
    const merged = mergeKinderChecklist(new Map());

    expect(merged.size).toBe(KINDER_COMPETENCY_COUNT);
    for (const entry of KINDER_COMPETENCY_ENTRIES_IN_ORDER) {
      expect(merged.get(entry.key)).toEqual(emptyCell());
    }
  });

  it("overlays a saved row onto the catalog, leaving untouched keys all-null", () => {
    const saved = new Map<KinderCompetencyKey, KinderChecklistCellState>([
      [
        "I.1",
        { t1Rating: "BEGINNING", t2Rating: "DEVELOPING", t3Rating: null, remark: "Needs support" },
      ],
    ]);

    const merged = mergeKinderChecklist(saved);

    expect(merged.get("I.1")).toEqual({
      t1Rating: "BEGINNING",
      t2Rating: "DEVELOPING",
      t3Rating: null,
      remark: "Needs support",
    });
    // A different key never saved reads as the all-null default, not undefined.
    expect(merged.get("I.2")).toEqual(emptyCell());
    // The size is still the fixed catalog count, not "1 saved row".
    expect(merged.size).toBe(KINDER_COMPETENCY_COUNT);
  });

  it("never re-points a stored rating at a different key from an unknown key in the saved map", () => {
    // A key that isn't in the catalog (e.g. a stale/renamed key) must not leak
    // into the merged result under any catalog key.
    const saved = new Map([
      ["NOT.A.KEY", { t1Rating: "CONSISTENT", t2Rating: null, t3Rating: null, remark: null }],
    ]) as unknown as Map<KinderCompetencyKey, KinderChecklistCellState>;

    const merged = mergeKinderChecklist(saved);

    expect(merged.size).toBe(KINDER_COMPETENCY_COUNT);
    // None of the real catalog entries picked up the bogus row's rating.
    expect([...merged.values()].some((c) => c.t1Rating === "CONSISTENT")).toBe(false);
  });
});

describe("countTouchedCompetencies", () => {
  it("nothing touched: 0 / 62, pct 0", () => {
    const merged = mergeKinderChecklist(new Map());
    const progress = countTouchedCompetencies(merged);

    expect(progress).toEqual({ touched: 0, total: KINDER_COMPETENCY_COUNT, pct: 0 });
  });

  it("a competency with only T1 rated counts as touched", () => {
    const saved = new Map<KinderCompetencyKey, KinderChecklistCellState>([
      ["I.1", { t1Rating: "BEGINNING", t2Rating: null, t3Rating: null, remark: null }],
    ]);
    const merged = mergeKinderChecklist(saved);
    const progress = countTouchedCompetencies(merged);

    expect(progress.touched).toBe(1);
    expect(progress.total).toBe(KINDER_COMPETENCY_COUNT);
  });

  it("a remark with no rating does NOT count as touched", () => {
    const saved = new Map<KinderCompetencyKey, KinderChecklistCellState>([
      ["I.1", { t1Rating: null, t2Rating: null, t3Rating: null, remark: "Some note" }],
    ]);
    const merged = mergeKinderChecklist(saved);
    const progress = countTouchedCompetencies(merged);

    expect(progress.touched).toBe(0);
  });

  it("computes a rounded percentage against the fixed 62, not the map size", () => {
    // Touch the first 31 of 62 catalog entries -> exactly half.
    const saved = new Map<KinderCompetencyKey, KinderChecklistCellState>();
    const half = Math.floor(KINDER_COMPETENCY_COUNT / 2);
    for (let i = 0; i < half; i++) {
      saved.set(KINDER_COMPETENCY_ENTRIES_IN_ORDER[i].key, {
        t1Rating: "CONSISTENT",
        t2Rating: null,
        t3Rating: null,
        remark: null,
      });
    }
    const merged = mergeKinderChecklist(saved);
    const progress = countTouchedCompetencies(merged);

    expect(progress.touched).toBe(half);
    expect(progress.total).toBe(KINDER_COMPETENCY_COUNT);
    expect(progress.pct).toBe(Math.round((half / KINDER_COMPETENCY_COUNT) * 100));
  });

  it("everything touched: 100%", () => {
    const saved = new Map<KinderCompetencyKey, KinderChecklistCellState>();
    for (const entry of KINDER_COMPETENCY_ENTRIES_IN_ORDER) {
      saved.set(entry.key, { t1Rating: null, t2Rating: null, t3Rating: "CONSISTENT", remark: null });
    }
    const merged = mergeKinderChecklist(saved);
    const progress = countTouchedCompetencies(merged);

    expect(progress.touched).toBe(KINDER_COMPETENCY_COUNT);
    expect(progress.pct).toBe(100);
  });
});

describe("splitByKinderGradeType", () => {
  it("splits Kindergarten placements from every other grade", () => {
    const placements = [
      { id: "a", gradeType: "KINDER" },
      { id: "b", gradeType: "G1" },
      { id: "c", gradeType: "KINDER" },
      { id: "d", gradeType: "G5" },
    ];

    const { kinder, numeric } = splitByKinderGradeType(placements);

    expect(kinder.map((p) => p.id)).toEqual(["a", "c"]);
    expect(numeric.map((p) => p.id)).toEqual(["b", "d"]);
  });

  it("an all-numeric scope produces an empty kinder side", () => {
    const placements = [{ id: "a", gradeType: "G3" }];

    const { kinder, numeric } = splitByKinderGradeType(placements);

    expect(kinder).toEqual([]);
    expect(numeric).toEqual(placements);
  });

  it("an all-Kinder scope produces an empty numeric side", () => {
    const placements = [{ id: "a", gradeType: "KINDER" }, { id: "b", gradeType: "KINDER" }];

    const { kinder, numeric } = splitByKinderGradeType(placements);

    expect(numeric).toEqual([]);
    expect(kinder).toEqual(placements);
  });
});
