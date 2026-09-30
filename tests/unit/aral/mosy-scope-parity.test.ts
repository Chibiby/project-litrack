import { describe, expect, it } from "vitest";
import type { AralMosyOutcome } from "@prisma/client";
import { MOSY_STATUSES, mosyRowStatus, mosyStatusWhere } from "@/lib/aral/mosy";
import { mosyLearnerScope, teacherOwnsMosyRow } from "@/lib/teachers/scope";

/**
 * Keeps the in-memory rules (`teacherOwnsMosyRow`, `mosyRowStatus`) and their
 * Prisma twins (`mosyLearnerScope`, `mosyStatusWhere`) in step. A tiny evaluator
 * interprets exactly the `where` operators those builders emit, over a fixture
 * matrix, so a change to one side that is not mirrored fails here.
 *
 * Scope is ADVISORY: the learner's current section is one of the teacher's
 * advisory sections, and the learner is ARAL-tagged or moved out this year.
 */

const YEAR = "year-1";
const OLD_YEAR = "year-0";
const A = "section-a";
const B = "section-b";
const C = "section-c";
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
  sectionId: string | null;
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
      case "sectionId": {
        const m = val as { in: string[] };
        return f.sectionId !== null && m.in.includes(f.sectionId);
      }
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

const fx = (
  name: string,
  isAralLearner: boolean,
  aralTeacherId: string | null,
  sectionId: string | null,
  rows: Row[]
): Fixture => ({ name, isAralLearner, aralTeacherId, sectionId, rows });

const FIXTURES: Fixture[] = [
  fx("tagged to T1, in A, no row", true, T1, A, []),
  fx("tagged to T2, in A, no row", true, T2, A, []),
  fx("tagged no tutor, in A", true, null, A, []),
  fx("tagged T1, in B, deferred", true, T1, B, [row(null, T1)]),
  fx("tagged T1, in A, STAY", true, T1, A, [row("STAY", T1)]),
  fx("tagged T1, in A, MOVE_OUT (re-enrolled since)", true, T1, A, [row("MOVE_OUT", T1)]),
  fx("tagged, in C (other adviser)", true, T1, C, []),
  fx("tagged, no section", true, T1, null, []),
  fx("untagged in A, T1 moved out", false, null, A, [row("MOVE_OUT", T1)]),
  fx("untagged in A, T2 moved out", false, null, A, [row("MOVE_OUT", T2)]),
  fx("untagged in B, moved out with null tutor", false, null, B, [row("MOVE_OUT", null)]),
  fx("untagged in C, moved out", false, null, C, [row("MOVE_OUT", T1)]),
  fx("untagged, no section, moved out", false, null, null, [row("MOVE_OUT", T1)]),
  fx("untagged in A, STAY row (toggled off later)", false, null, A, [row("STAY", T1)]),
  fx("untagged in A, deferred row", false, null, A, [row(null, T1)]),
  fx("untagged in A, no row", false, null, A, []),
  fx("untagged in A, MOVE_OUT last year only", false, null, A, [row("MOVE_OUT", T1, OLD_YEAR)]),
  fx("tagged in A, only last year's STAY", true, T1, A, [row("STAY", T1, OLD_YEAR)]),
];

const existingFor = (f: Fixture) => {
  const r = f.rows.find((x) => x.schoolYearId === YEAR);
  return r ? { decision: r.decision } : null;
};

const SCOPES: [string, string[] | null][] = [
  ["adviser of A", [A]],
  ["adviser of A and B", [A, B]],
  ["adviser of C", [C]],
  ["adviser of nothing", []],
  ["whole school", null],
];

describe("mosyLearnerScope <-> teacherOwnsMosyRow", () => {
  for (const [label, sectionIds] of SCOPES) {
    it(`agree for every fixture as ${label}`, () => {
      for (const f of FIXTURES) {
        const inMemory = teacherOwnsMosyRow(f, existingFor(f), sectionIds);
        const viaWhere = evalWhere(f, mosyLearnerScope(sectionIds, YEAR));
        expect(viaWhere, f.name).toBe(inMemory);
      }
    });
  }

  it("matches the exact where for an adviser", () => {
    expect(mosyLearnerScope([A, B], YEAR)).toEqual({
      sectionId: { in: [A, B] },
      OR: [
        { isAralLearner: true },
        {
          isAralLearner: false,
          mosyDecisions: { some: { schoolYearId: YEAR, decision: "MOVE_OUT" } },
        },
      ],
    });
  });

  it("never consults the ARAL tutor: no aralTeacherId or tutorId anywhere", () => {
    for (const [, s] of SCOPES) {
      const json = JSON.stringify(mosyLearnerScope(s, YEAR));
      expect(json).not.toContain("tutorId");
      expect(json).not.toContain("aralTeacherId");
    }
  });

  it("a null scope (Super Admin) drops the section filter and nothing else", () => {
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
    expect(where).not.toHaveProperty("sectionId");
  });

  it("whole-school view sees every tagged learner and this year's moved-out ones only", () => {
    const seen = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope(null, YEAR))).map((f) => f.name);
    expect(seen).toContain("tagged to T2, in A, no row");
    expect(seen).toContain("untagged in A, T2 moved out");
    expect(seen).not.toContain("untagged in A, STAY row (toggled off later)");
    expect(seen).not.toContain("untagged in A, MOVE_OUT last year only");
    expect(seen).not.toContain("untagged in A, no row");
  });

  it("an adviser sees a section's learners whoever the tutor is, tagged or moved out by anyone", () => {
    const seen = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope([A], YEAR))).map((f) => f.name);
    expect(seen).toContain("tagged to T1, in A, no row");
    expect(seen).toContain("tagged to T2, in A, no row");
    expect(seen).toContain("tagged no tutor, in A");
    expect(seen).toContain("untagged in A, T1 moved out");
    expect(seen).toContain("untagged in A, T2 moved out");
  });

  it("learners in other sections, sectionless learners and stale rows are excluded", () => {
    const seen = FIXTURES.filter((f) => evalWhere(f, mosyLearnerScope([A], YEAR))).map((f) => f.name);
    expect(seen).not.toContain("tagged T1, in B, deferred");
    expect(seen).not.toContain("tagged, in C (other adviser)");
    expect(seen).not.toContain("tagged, no section");
    expect(seen).not.toContain("untagged, no section, moved out");
    expect(seen).not.toContain("untagged in A, MOVE_OUT last year only");
    expect(seen).not.toContain("untagged in A, no row");
  });

  it("a moved-out learner is visible only in the year it happened", () => {
    const f = FIXTURES.find((x) => x.name === "untagged in A, T1 moved out")!;
    expect(evalWhere(f, mosyLearnerScope([A], YEAR))).toBe(true);
    expect(evalWhere(f, mosyLearnerScope([A], "year-2"))).toBe(false);
  });

  it("an empty advisory list matches nobody, in memory and in the where", () => {
    for (const f of FIXTURES) {
      expect(evalWhere(f, mosyLearnerScope([], YEAR)), f.name).toBe(false);
      expect(teacherOwnsMosyRow(f, existingFor(f), []), f.name).toBe(false);
    }
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
