import { describe, expect, it } from "vitest";
import type { AralMosyOutcome } from "@prisma/client";
import { MOSY_STATUSES, mosyRowStatus, mosyStatusWhere } from "@/lib/aral/mosy";
import { mosyLearnerScope, teacherOwnsMosyRow } from "@/lib/teachers/scope";

/**
 * Keeps the in-memory rules (`teacherOwnsMosyRow`, `mosyRowStatus`) and their
 * Prisma twins (`mosyLearnerScope`, `mosyStatusWhere`) in step. A tiny evaluator
 * interprets exactly the `where` operators those builders emit, over a fixture
 * matrix, so a change to one side that is not mirrored fails here.
 */

const YEAR = "year-1";
const OLD_YEAR = "year-0";
const T1 = "tutor-1";
const T2 = "tutor-2";

type Row = {
  schoolYearId: string;
  decision: AralMosyOutcome | null;
  tutorId: string | null;
};
type Fixture = {
  name: string;
  isAralLearner: boolean;
  aralTeacherId: string | null;
  rows: Row[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Where = Record<string, any>;

function matchRow(row: Row, w: Where): boolean {
  return Object.entries(w).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
}

function evalWhere(f: Fixture, w: Where): boolean {
  return Object.entries(w).every(([key, val]) => {
    switch (key) {
      case "AND":
        return (val as Where[]).every((c) => evalWhere(f, c));
      case "OR":
        return (val as Where[]).some((c) => evalWhere(f, c));
      case "isAralLearner":
        return f.isAralLearner === val;
      case "aralTeacherId":
        return f.aralTeacherId === val;
      case "mosyDecisions": {
        const m = val as { some?: Where; none?: Where };
        if (m.some) return f.rows.some((r) => matchRow(r, m.some!));
        if (m.none) return !f.rows.some((r) => matchRow(r, m.none!));
        throw new Error("unsupported relation filter");
      }
      default:
        throw new Error(`evaluator does not know key "${key}"`);
    }
  });
}

const row = (decision: AralMosyOutcome | null, tutorId: string | null, schoolYearId = YEAR): Row => ({
  schoolYearId,
  decision,
  tutorId,
});

const FIXTURES: Fixture[] = [
  { name: "tagged to T1, no row", isAralLearner: true, aralTeacherId: T1, rows: [] },
  { name: "tagged to T2, no row", isAralLearner: true, aralTeacherId: T2, rows: [] },
  { name: "tagged no tutor, no row", isAralLearner: true, aralTeacherId: null, rows: [] },
  { name: "tagged T1, deferred", isAralLearner: true, aralTeacherId: T1, rows: [row(null, T1)] },
  { name: "tagged T1, STAY", isAralLearner: true, aralTeacherId: T1, rows: [row("STAY", T1)] },
  { name: "tagged T1, MOVE_OUT (re-enrolled since)", isAralLearner: true, aralTeacherId: T1, rows: [row("MOVE_OUT", T1)] },
  { name: "untagged, T1 moved out", isAralLearner: false, aralTeacherId: null, rows: [row("MOVE_OUT", T1)] },
  { name: "untagged, T2 moved out", isAralLearner: false, aralTeacherId: null, rows: [row("MOVE_OUT", T2)] },
  { name: "untagged, moved out with null tutor", isAralLearner: false, aralTeacherId: null, rows: [row("MOVE_OUT", null)] },
  { name: "untagged, STAY row (toggled off later)", isAralLearner: false, aralTeacherId: null, rows: [row("STAY", T1)] },
  { name: "untagged, deferred row", isAralLearner: false, aralTeacherId: null, rows: [row(null, T1)] },
  { name: "untagged, no row", isAralLearner: false, aralTeacherId: null, rows: [] },
  { name: "untagged, T1 MOVE_OUT last year only", isAralLearner: false, aralTeacherId: null, rows: [row("MOVE_OUT", T1, OLD_YEAR)] },
  { name: "tagged T1, only last year's STAY", isAralLearner: true, aralTeacherId: T1, rows: [row("STAY", T1, OLD_YEAR)] },
];

const existingFor = (f: Fixture) => {
  const r = f.rows.find((x) => x.schoolYearId === YEAR);
  return r ? { decision: r.decision, tutorId: r.tutorId } : null;
};

describe("mosyLearnerScope <-> teacherOwnsMosyRow", () => {
  for (const teacher of [T1, T2, "someone-else"]) {
    it(`agree for every fixture as ${teacher}`, () => {
      for (const f of FIXTURES) {
        const inMemory = teacherOwnsMosyRow(f, existingFor(f), teacher);
        const viaWhere = evalWhere(f, mosyLearnerScope(teacher, YEAR));
        expect(viaWhere, f.name).toBe(inMemory);
      }
    });
  }

  it("matches the exact where for a tutor", () => {
    expect(mosyLearnerScope(T1, YEAR)).toEqual({
      OR: [
        { isAralLearner: true, aralTeacherId: T1 },
        {
          isAralLearner: false,
          mosyDecisions: { some: { schoolYearId: YEAR, decision: "MOVE_OUT", tutorId: T1 } },
        },
      ],
    });
  });

  it("a null teacher (Super Admin) drops both tutor filters and nothing else", () => {
    const where = mosyLearnerScope(null, YEAR);
    expect(where).toEqual({
      OR: [
        { isAralLearner: true },
        {
          isAralLearner: false,
          mosyDecisions: { some: { schoolYearId: YEAR, decision: "MOVE_OUT" } },
        },
      ],
    });
    expect(JSON.stringify(where)).not.toContain("tutorId");
    expect(JSON.stringify(where)).not.toContain("aralTeacherId");
  });

  it("whole-school view sees every tagged learner and this year's moved-out ones only", () => {
    const seen = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope(null, YEAR))).map((f) => f.name);
    expect(seen).toContain("tagged to T2, no row");
    expect(seen).toContain("untagged, T2 moved out");
    expect(seen).not.toContain("untagged, STAY row (toggled off later)");
    expect(seen).not.toContain("untagged, T1 MOVE_OUT last year only");
    expect(seen).not.toContain("untagged, no row");
  });

  it("a moved-out learner is visible only to the tutor who moved them, only this year", () => {
    const f = FIXTURES.find((x) => x.name === "untagged, T1 moved out")!;
    expect(evalWhere(f, mosyLearnerScope(T1, YEAR))).toBe(true);
    expect(evalWhere(f, mosyLearnerScope(T2, YEAR))).toBe(false);
    expect(evalWhere(f, mosyLearnerScope(T1, "year-2"))).toBe(false);
  });

  it("an adviser who is not the tutor never matches a tagged learner", () => {
    const f = FIXTURES.find((x) => x.name === "tagged to T2, no row")!;
    expect(evalWhere(f, mosyLearnerScope(T1, YEAR))).toBe(false);
    expect(teacherOwnsMosyRow(f, null, T1)).toBe(false);
  });
});

describe("mosyStatusWhere <-> mosyRowStatus", () => {
  it("every in-scope fixture matches its own status filter, and for_decision also takes not_updated", () => {
    const inScope = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope(null, YEAR)));
    expect(inScope.length).toBeGreaterThan(5);
    for (const f of inScope) {
      const r = f.rows.find((x) => x.schoolYearId === YEAR) ?? null;
      const expected = mosyRowStatus({ isAralLearner: f.isAralLearner, row: r });
      for (const s of MOSY_STATUSES) {
        const matches = evalWhere(f, mosyStatusWhere(s, YEAR));
        // "For decision" = still waiting for a move out or stay decision, which
        // includes learners whose MOSY level is not saved yet.
        const shouldMatch =
          s === "all" || s === expected || (s === "for_decision" && expected === "not_updated");
        expect(matches, `${f.name} vs ${s} (row status ${expected})`).toBe(shouldMatch);
      }
    }
  });

  it("not_updated is a subset of for_decision, which with moved_out and stay partitions the scope", () => {
    const inScope = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope(null, YEAR)));
    const count = (s: (typeof MOSY_STATUSES)[number]) =>
      inScope.filter((f) => evalWhere(f, mosyStatusWhere(s, YEAR))).length;
    expect(count("not_updated")).toBeGreaterThan(0);
    expect(count("for_decision")).toBeGreaterThan(count("not_updated"));
    expect(count("for_decision") + count("moved_out") + count("stay")).toBe(count("all"));
    expect(count("all")).toBe(inScope.length);
  });

  it("all adds no constraint", () => {
    expect(mosyStatusWhere("all", YEAR)).toEqual({});
  });

  it("no status clause uses a top-level OR (it would collide with the scope's OR)", () => {
    for (const s of MOSY_STATUSES) {
      expect(mosyStatusWhere(s, YEAR)).not.toHaveProperty("OR");
    }
  });

  it("every clause is pinned to the school year", () => {
    for (const s of MOSY_STATUSES.filter((x) => x !== "all")) {
      expect(JSON.stringify(mosyStatusWhere(s, YEAR))).toContain(`"schoolYearId":"${YEAR}"`);
    }
  });
});
