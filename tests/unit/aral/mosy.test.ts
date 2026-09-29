import { describe, expect, it } from "vitest";
import type { AralMosyMoveOutReason, AralMosyOutcome, ReadingProfile } from "@prisma/client";
import {
  MOSY_STATUSES,
  computeMosyStats,
  formatPreviousLevel,
  mosyMoveOutReasonsForGrade,
  mosyRowStatus,
  parseMosyStatus,
  resolveMosySave,
  type MosySaveInput,
} from "@/lib/aral/mosy";

/**
 * Pure decision layer for the MOSY Report. Spec:
 * docs/superpowers/specs/2026-09-29-mosy-report-page-design.md sections 2.5 and 7.
 *
 * The headline invariant is "changing the level never untags": every level-change
 * case below asserts `learnerPatch === null`, and the only inputs that may produce
 * a patch are MOVE_OUT on a tagged learner and STAY on an untagged one.
 */

const ACTOR = "tutor-1";
const OTHER = "tutor-2";
const NOW = new Date("2026-09-29T02:00:00.000Z");
const ENROLLED = new Date("2026-06-10T00:00:00.000Z");

type Learner = MosySaveInput["learner"];
type Existing = NonNullable<MosySaveInput["existing"]>;
type Submitted = MosySaveInput["submitted"];

const tagged = (over: Partial<Learner> = {}): Learner => ({
  gradeType: "G4",
  isAralLearner: true,
  aralTeacherId: ACTOR,
  aralEnrolledAt: ENROLLED,
  ...over,
});
const untagged = (over: Partial<Learner> = {}): Learner => ({
  gradeType: "G4",
  isAralLearner: false,
  aralTeacherId: null,
  aralEnrolledAt: null,
  ...over,
});
const movedOutRow = (over: Partial<Existing> = {}): Existing => ({
  decision: "MOVE_OUT",
  tutorId: ACTOR,
  priorAralEnrolledAt: ENROLLED,
  ...over,
});
const submit = (over: Partial<Submitted> = {}): Submitted => ({
  mosyLevel: "INSTRUCTIONAL_DEVELOPING",
  decision: null,
  reason: null,
  remarks: null,
  ...over,
});

function resolve(args: {
  learner: Learner;
  existing?: Existing | null;
  submitted?: Partial<Submitted>;
  actorId?: string;
}) {
  return resolveMosySave({
    actorId: args.actorId ?? ACTOR,
    now: NOW,
    learner: args.learner,
    existing: args.existing ?? null,
    submitted: submit(args.submitted),
  });
}

function expectFail(res: ReturnType<typeof resolveMosySave>, failure: string) {
  expect(res).toEqual({ ok: false, failure });
}

function expectOk(res: ReturnType<typeof resolveMosySave>) {
  if (!res.ok) throw new Error(`expected ok, got ${res.failure}`);
  return res;
}

describe("mosyMoveOutReasonsForGrade", () => {
  const EARLY: AralMosyMoveOutReason[] = [
    "IMPROVED_EARLY_GRADES",
    "DIAGNOSED_LSEN",
    "RECOMMENDED_LSEN_ASSESSMENT",
  ];
  const UPPER: AralMosyMoveOutReason[] = [
    "IMPROVED_UPPER_GRADES",
    "DIAGNOSED_LSEN",
    "RECOMMENDED_LSEN_ASSESSMENT",
  ];

  it.each(["KINDER", "G1", "G2", "G3"])("%s gets the early-grades improvement reason", (g) => {
    expect(mosyMoveOutReasonsForGrade(g)).toEqual(EARLY);
  });

  it.each(["G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING"])(
    "%s gets the upper-grades improvement reason",
    (g) => {
      expect(mosyMoveOutReasonsForGrade(g)).toEqual(UPPER);
    }
  );

  it("never offers both improvement reasons at once", () => {
    for (const g of ["KINDER", "G3", "G4", "G11", "FLOATING"]) {
      const r = mosyMoveOutReasonsForGrade(g);
      expect(
        r.includes("IMPROVED_EARLY_GRADES") && r.includes("IMPROVED_UPPER_GRADES")
      ).toBe(false);
    }
  });
});

describe("resolveMosySave — never untags on a level change", () => {
  const levels: ReadingProfile[] = [
    "NON_DECODER_LOW_EMERGENT",
    "FRUSTRATION_HIGH_EMERGENT",
    "INSTRUCTIONAL_DEVELOPING",
    "INDEPENDENT_GRADE_READY",
  ];

  it.each(levels)("tagged learner, level %s, decision null, no row: no patch", (mosyLevel) => {
    const res = expectOk(resolve({ learner: tagged(), submitted: { mosyLevel, decision: null } }));
    expect(res.learnerPatch).toBeNull();
    expect(res.transition).toBe("NONE");
    expect(res.row.mosyLevel).toBe(mosyLevel);
    expect(res.row.decision).toBeNull();
  });

  it.each(levels)("tagged learner, level %s, STAY: no patch", (mosyLevel) => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        existing: { decision: "STAY", tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { mosyLevel, decision: "STAY" },
      })
    );
    expect(res.learnerPatch).toBeNull();
    expect(res.transition).toBe("NONE");
  });

  it("tagged learner with a deferred row changing level and STAY: no patch, never untagged", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        existing: { decision: null, tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { mosyLevel: "INDEPENDENT_GRADE_READY", decision: "STAY" },
      })
    );
    expect(res.learnerPatch).toBeNull();
    expect(res.row.decision).toBe("STAY");
  });

  it("a decision-null save on a tagged learner does not touch aral fields", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        existing: { decision: null, tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { mosyLevel: "FRUSTRATION_HIGH_EMERGENT", decision: null },
      })
    );
    expect(res.learnerPatch).toBeNull();
  });
});

describe("resolveMosySave — MOVE_OUT on a tagged learner", () => {
  it("untags, clears tutor and date, and captures the prior date", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: { decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN", remarks: "ok" },
      })
    );
    expect(res.transition).toBe("MOVED_OUT");
    expect(res.learnerPatch).toEqual({
      isAralLearner: false,
      aralTeacherId: null,
      aralEnrolledAt: null,
    });
    expect(res.row).toMatchObject({
      decision: "MOVE_OUT",
      reason: "DIAGNOSED_LSEN",
      remarks: "ok",
      tutorId: ACTOR,
      priorAralEnrolledAt: ENROLLED,
    });
  });

  it("captures a null prior date when the learner had none", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ aralEnrolledAt: null }),
        submitted: { decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" },
      })
    );
    expect(res.row.priorAralEnrolledAt).toBeNull();
  });

  it("never leaves aralTeacherId set when the patch untags", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: { decision: "MOVE_OUT", reason: "RECOMMENDED_LSEN_ASSESSMENT" },
      })
    );
    expect(res.learnerPatch?.isAralLearner).toBe(false);
    expect(res.learnerPatch?.aralTeacherId).toBeNull();
  });

  it("accepts the upper-grades improvement reason for G4+", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G6" }),
        submitted: { decision: "MOVE_OUT", reason: "IMPROVED_UPPER_GRADES" },
      })
    );
    expect(res.transition).toBe("MOVED_OUT");
  });

  it("accepts the early-grades improvement reason for Kinder", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        submitted: {
          mosyLevel: "CV_BLENDING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_EARLY_GRADES",
        },
      })
    );
    expect(res.transition).toBe("MOVED_OUT");
  });
});

describe("resolveMosySave — STAY / re-tag", () => {
  it("re-tags an untagged learner with the actor and the restored prior date", () => {
    const res = expectOk(
      resolve({
        learner: untagged(),
        existing: movedOutRow(),
        submitted: { decision: "STAY" },
      })
    );
    expect(res.transition).toBe("RETAGGED");
    expect(res.learnerPatch).toEqual({
      isAralLearner: true,
      aralTeacherId: ACTOR,
      aralEnrolledAt: ENROLLED,
    });
    expect(res.row.priorAralEnrolledAt).toBeNull();
    expect(res.row.reason).toBeNull();
  });

  it("falls back to now when there is no prior date", () => {
    const res = expectOk(
      resolve({
        learner: untagged(),
        existing: movedOutRow({ priorAralEnrolledAt: null }),
        submitted: { decision: "STAY" },
      })
    );
    expect(res.learnerPatch?.aralEnrolledAt).toEqual(NOW);
  });

  it("STAY on a tagged learner produces no patch", () => {
    const res = expectOk(resolve({ learner: tagged(), submitted: { decision: "STAY" } }));
    expect(res.learnerPatch).toBeNull();
    expect(res.transition).toBe("NONE");
  });

  it("forces the reason to null for STAY even if one is submitted", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: { decision: "STAY", reason: "DIAGNOSED_LSEN" },
      })
    );
    expect(res.row.reason).toBeNull();
  });

  it("forces the reason to null for a deferred decision", () => {
    const res = expectOk(
      resolve({ learner: tagged(), submitted: { decision: null, reason: "DIAGNOSED_LSEN" } })
    );
    expect(res.row.reason).toBeNull();
  });

  it("re-saving MOVE_OUT on an already moved-out learner keeps the prior date and does not patch", () => {
    const res = expectOk(
      resolve({
        learner: untagged(),
        existing: movedOutRow(),
        submitted: {
          mosyLevel: "INDEPENDENT_GRADE_READY",
          decision: "MOVE_OUT",
          reason: "DIAGNOSED_LSEN",
        },
      })
    );
    expect(res.learnerPatch).toBeNull();
    expect(res.transition).toBe("NONE");
    expect(res.row.priorAralEnrolledAt).toEqual(ENROLLED);
  });

  it("a level-only change on a moved-out learner (decision kept MOVE_OUT) never re-tags", () => {
    const res = expectOk(
      resolve({
        learner: untagged(),
        existing: movedOutRow(),
        submitted: {
          mosyLevel: "FRUSTRATION_HIGH_EMERGENT",
          decision: "MOVE_OUT",
          reason: "RECOMMENDED_LSEN_ASSESSMENT",
        },
      })
    );
    expect(res.learnerPatch).toBeNull();
  });
});

describe("resolveMosySave — deferred decision", () => {
  it("is allowed with no row on a tagged learner", () => {
    expectOk(resolve({ learner: tagged(), submitted: { decision: null } }));
  });

  it("is allowed with an existing deferred row on a tagged learner", () => {
    expectOk(
      resolve({
        learner: tagged(),
        existing: { decision: null, tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { decision: null },
      })
    );
  });

  it("is DECISION_REQUIRED once a STAY exists", () => {
    expectFail(
      resolve({
        learner: tagged(),
        existing: { decision: "STAY", tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { decision: null },
      }),
      "DECISION_REQUIRED"
    );
  });

  it("is DECISION_REQUIRED once a MOVE_OUT exists and the learner is re-tagged", () => {
    expectFail(
      resolve({
        learner: tagged(),
        existing: movedOutRow(),
        submitted: { decision: null },
      }),
      "DECISION_REQUIRED"
    );
  });

  it("is DECISION_REQUIRED on an untagged (moved-out) learner", () => {
    expectFail(
      resolve({ learner: untagged(), existing: movedOutRow(), submitted: { decision: null } }),
      "DECISION_REQUIRED"
    );
  });
});

describe("resolveMosySave — rejected paths", () => {
  it("MOVE_OUT without a reason is REASON_REQUIRED", () => {
    expectFail(
      resolve({ learner: tagged(), submitted: { decision: "MOVE_OUT", reason: null } }),
      "REASON_REQUIRED"
    );
  });

  it("G2 with the upper-grades reason is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G2" }),
        submitted: { decision: "MOVE_OUT", reason: "IMPROVED_UPPER_GRADES" },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("G4 with the early-grades reason is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G4" }),
        submitted: { decision: "MOVE_OUT", reason: "IMPROVED_EARLY_GRADES" },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("G11 with the early-grades reason is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G11" }),
        submitted: {
          mosyLevel: "INSTRUCTIONAL_DEVELOPING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_EARLY_GRADES",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("Kinder with the upper-grades reason is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        submitted: {
          mosyLevel: "LETTER_LEVEL",
          decision: "MOVE_OUT",
          reason: "IMPROVED_UPPER_GRADES",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("Kinder with an early-rubric level and the early reason is accepted (Kinder gets EARLY)", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        submitted: {
          mosyLevel: "LETTER_LEVEL",
          decision: "MOVE_OUT",
          reason: "IMPROVED_EARLY_GRADES",
        },
      })
    );
    expect(res.row.reason).toBe("IMPROVED_EARLY_GRADES");
  });

  it("Kinder with a standard-band level is LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        submitted: { mosyLevel: "INSTRUCTIONAL_DEVELOPING", decision: "STAY" },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("G11 with NON_DECODER_LOW_EMERGENT is LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G11" }),
        submitted: { mosyLevel: "NON_DECODER_LOW_EMERGENT", decision: "STAY" },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("G4 with an early-rubric level is LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G4" }),
        submitted: { mosyLevel: "CVC_BLENDING", decision: "STAY" },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("checks the level before the decision, so a bad level never reaches a patch", () => {
    const res = resolve({
      learner: tagged({ gradeType: "KINDER" }),
      submitted: {
        mosyLevel: "INSTRUCTIONAL_DEVELOPING",
        decision: "MOVE_OUT",
        reason: "IMPROVED_EARLY_GRADES",
      },
    });
    expectFail(res, "LEVEL_NOT_ALLOWED");
  });
});

describe("resolveMosySave — out of scope", () => {
  it("another tutor on a tagged learner", () => {
    expectFail(
      resolve({
        learner: tagged({ aralTeacherId: OTHER }),
        submitted: { decision: "STAY" },
      }),
      "OUT_OF_SCOPE"
    );
  });

  it("a tagged learner with no designated tutor (adviser is not the tutor)", () => {
    expectFail(
      resolve({
        learner: tagged({ aralTeacherId: null }),
        submitted: { decision: "STAY" },
      }),
      "OUT_OF_SCOPE"
    );
  });

  it("untagged with a STAY row", () => {
    expectFail(
      resolve({
        learner: untagged(),
        existing: { decision: "STAY", tutorId: ACTOR, priorAralEnrolledAt: null },
        submitted: { decision: "STAY" },
      }),
      "OUT_OF_SCOPE"
    );
  });

  it("untagged with no row at all", () => {
    expectFail(
      resolve({ learner: untagged(), existing: null, submitted: { decision: "STAY" } }),
      "OUT_OF_SCOPE"
    );
  });

  it("untagged with another tutor's MOVE_OUT", () => {
    expectFail(
      resolve({
        learner: untagged(),
        existing: movedOutRow({ tutorId: OTHER }),
        submitted: { decision: "STAY" },
      }),
      "OUT_OF_SCOPE"
    );
  });

  it("an actor that owns nothing (Super Admin-like id) never resolves ok, even with a valid payload", () => {
    for (const learner of [tagged(), untagged()]) {
      expectFail(
        resolve({
          actorId: "super-admin-1",
          learner,
          existing: learner.isAralLearner ? null : movedOutRow(),
          submitted: { decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" },
        }),
        "OUT_OF_SCOPE"
      );
    }
  });

  it("scope is checked before level and reason validation", () => {
    expectFail(
      resolve({
        actorId: OTHER,
        learner: tagged({ gradeType: "KINDER" }),
        submitted: { mosyLevel: "INSTRUCTIONAL_DEVELOPING", decision: "MOVE_OUT", reason: null },
      }),
      "OUT_OF_SCOPE"
    );
  });
});

describe("mosyRowStatus", () => {
  const status = (isAralLearner: boolean, decision: AralMosyOutcome | null | "none") =>
    mosyRowStatus({
      isAralLearner,
      row: decision === "none" ? null : { decision },
    });

  it("no row is not_updated", () => {
    expect(status(true, "none")).toBe("not_updated");
  });
  it("null decision is for_decision", () => {
    expect(status(true, null)).toBe("for_decision");
  });
  it("MOVE_OUT and untagged is moved_out", () => {
    expect(status(false, "MOVE_OUT")).toBe("moved_out");
  });
  it("MOVE_OUT but tagged again is for_decision", () => {
    expect(status(true, "MOVE_OUT")).toBe("for_decision");
  });
  it("STAY is stay", () => {
    expect(status(true, "STAY")).toBe("stay");
  });
});

describe("parseMosyStatus", () => {
  it.each(MOSY_STATUSES)("keeps %s", (s) => {
    expect(parseMosyStatus(s)).toBe(s);
  });
  it.each([undefined, "", "bogus", "ALL", "moved-out"])("%s falls back to all", (raw) => {
    expect(parseMosyStatus(raw)).toBe("all");
  });
});

describe("computeMosyStats", () => {
  it("derives updated as total minus not updated", () => {
    const s = computeMosyStats({ total: 10, notUpdated: 4, forDecision: 2, movedOut: 3, stay: 1 });
    expect(s).toMatchObject({ total: 10, updated: 6, forDecision: 2, movedOut: 3, stay: 1 });
  });

  it("clamps negatives to zero", () => {
    const s = computeMosyStats({ total: -5, notUpdated: 3, forDecision: -1, movedOut: -2, stay: -3 });
    expect(s).toMatchObject({ total: 0, updated: 0, forDecision: 0, movedOut: 0, stay: 0 });
  });

  it("never lets updated go negative when notUpdated exceeds total", () => {
    expect(computeMosyStats({ total: 2, notUpdated: 9, forDecision: 0, movedOut: 0, stay: 0 }).updated).toBe(0);
  });

  it("ignores a negative notUpdated rather than inflating updated past total", () => {
    expect(computeMosyStats({ total: 5, notUpdated: -3, forDecision: 0, movedOut: 0, stay: 0 }).updated).toBe(5);
  });

  it("emits the five cards in order with matching values", () => {
    const s = computeMosyStats({ total: 8, notUpdated: 2, forDecision: 1, movedOut: 2, stay: 3 });
    expect(s.cards.map((c) => [c.key, c.value])).toEqual([
      ["total", 8],
      ["updated", 6],
      ["forDecision", 1],
      ["movedOut", 2],
      ["stay", 3],
    ]);
    expect(s.cards[0].hint).toBe("This school year, including moved out");
  });
});

describe("formatPreviousLevel", () => {
  const record = {
    monthKey: "2026-08-03",
    englishProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoProfile: "FRUSTRATION_HIGH_EMERGENT",
  };

  it("returns null with no record", () => {
    expect(formatPreviousLevel(null, "G4")).toBeNull();
  });

  it("shows both languages for G4", () => {
    const out = formatPreviousLevel(record, "G4");
    expect(out?.filipino).toBeTruthy();
    expect(out?.english).toBeTruthy();
    expect(out?.filipino).not.toBe(out?.english);
  });

  it.each(["G1", "G2"])("drops English for %s even when the record has one", (g) => {
    const out = formatPreviousLevel(record, g);
    expect(out?.english).toBeNull();
    expect(out?.filipino).toBeTruthy();
  });

  it("keeps both languages for Kinder and G3 (languagesForGrade)", () => {
    const kinder = formatPreviousLevel(
      { ...record, englishProfile: "LETTER_LEVEL", filipinoProfile: "LETTER_LEVEL" },
      "KINDER"
    );
    expect(kinder?.english).toBeTruthy();
    expect(kinder?.filipino).toBeTruthy();
    expect(formatPreviousLevel(record, "G3")?.english).toBeTruthy();
  });

  it("null profiles stay null", () => {
    const out = formatPreviousLevel({ monthKey: "2026-08-03", englishProfile: null, filipinoProfile: null }, "G4");
    expect(out).toMatchObject({ filipino: null, english: null });
  });

  it("derives the month from the local date key, not UTC (first of month must not slip back)", () => {
    const out = formatPreviousLevel({ ...record, monthKey: "2026-09-01" }, "G4");
    expect(out?.monthLabel).toMatch(/Sep/);
    expect(out?.monthLabel).toMatch(/2026/);
    const out2 = formatPreviousLevel({ ...record, monthKey: "2026-08-31" }, "G4");
    expect(out2?.monthLabel).toMatch(/Aug/);
  });
});
