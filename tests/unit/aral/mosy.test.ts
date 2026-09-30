import { describe, expect, it } from "vitest";
import { GradeLevelType } from "@prisma/client";
import type { AralMosyOutcome, ReadingProfile } from "@prisma/client";
import {
  MOSY_STATUSES,
  computeMosyStats,
  formatPreviousLevel,
  mosyReasonChoices,
  mosyReasonLabel,
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
  improvedToLevel: null,
  remarks: null,
  ...over,
});

function resolve(args: {
  learner: Learner;
  existing?: Existing | null;
  submitted?: Partial<Submitted>;
  actorId?: string;
  previousFilipinoLevel?: string | null;
}) {
  return resolveMosySave({
    actorId: args.actorId ?? ACTOR,
    now: NOW,
    learner: args.learner,
    existing: args.existing ?? null,
    submitted: submit(args.submitted),
    previousFilipinoLevel: args.previousFilipinoLevel ?? null,
  });
}

function expectFail(res: ReturnType<typeof resolveMosySave>, failure: string) {
  expect(res).toEqual({ ok: false, failure });
}

function expectOk(res: ReturnType<typeof resolveMosySave>) {
  if (!res.ok) throw new Error(`expected ok, got ${res.failure}`);
  return res;
}

describe("mosyReasonChoices", () => {
  const labels = (g: string, prev: string | null) =>
    mosyReasonChoices(g, prev).map((c) => c.label);
  const LSEN = [
    "Diagnosed as Learner with Special Educational Needs (LSEN)",
    "Recommended for LSEN assessment",
  ];

  it("operator example: Grade 3, previous Low Emergent offers the three levels above it", () => {
    expect(labels("G3", "NON_DECODER_LOW_EMERGENT")).toEqual([
      "Improved to High Emergent",
      "Improved to Developing or Transitioning",
      "Improved to Grade-level Ready",
      ...LSEN,
    ]);
  });

  it("offers only levels strictly above the previous level (mid-scale)", () => {
    const c = mosyReasonChoices("G3", "FRUSTRATION_HIGH_EMERGENT");
    expect(
      c.filter((x) => x.reason === "IMPROVED_READING_LEVEL").map((x) => x.improvedToLevel)
    ).toEqual(["INSTRUCTIONAL_DEVELOPING", "INDEPENDENT_GRADE_READY"]);
  });

  it("previous at the top of the scale offers no improvement, only LSEN", () => {
    const c = mosyReasonChoices("G3", "INDEPENDENT_GRADE_READY");
    expect(c.map((x) => x.reason)).toEqual(["DIAGNOSED_LSEN", "RECOMMENDED_LSEN_ASSESSMENT"]);
    expect(c.every((x) => x.improvedToLevel === null)).toBe(true);
  });

  it("null previous offers every level but the lowest", () => {
    expect(labels("G3", null).slice(0, 3)).toEqual([
      "Improved to High Emergent",
      "Improved to Developing or Transitioning",
      "Improved to Grade-level Ready",
    ]);
    expect(mosyReasonChoices("G3", null)).toHaveLength(5);
  });

  it("a previous level outside the grade's scale behaves like no previous level", () => {
    // Legacy Kinder rubric value on a G4 learner.
    expect(mosyReasonChoices("G4", "LETTER_LEVEL")).toEqual(mosyReasonChoices("G4", null));
    expect(mosyReasonChoices("G4", "not-a-level")).toEqual(mosyReasonChoices("G4", null));
  });

  it("Kinder uses the early rubric scale", () => {
    expect(labels("KINDER", "LETTER_LEVEL")).toEqual([
      "Improved to Level 2 - CV blending",
      "Improved to Level 3 - CVC blending",
      ...LSEN,
    ]);
    expect(
      mosyReasonChoices("KINDER", null)
        .filter((c) => c.improvedToLevel)
        .map((c) => c.improvedToLevel)
    ).toEqual(["LETTER_LEVEL", "CV_BLENDING", "CVC_BLENDING"]);
  });

  it("SHS (G11/G12) uses the three-level scale", () => {
    for (const g of ["G11", "G12"]) {
      expect(labels(g, "FRUSTRATION_HIGH_EMERGENT")).toEqual([
        "Improved to Instructional Level",
        "Improved to Independent Level",
        ...LSEN,
      ]);
      // Nothing to offer but the top level when previous is the lowest SHS level.
      expect(
        mosyReasonChoices(g, null).filter((c) => c.improvedToLevel).map((c) => c.improvedToLevel)
      ).toEqual(["INSTRUCTIONAL_DEVELOPING", "INDEPENDENT_GRADE_READY"]);
    }
  });

  it("G4+ uses the PHIL-IRI band labels", () => {
    expect(labels("G6", "NON_DECODER_LOW_EMERGENT")).toEqual([
      "Improved to Frustration",
      "Improved to Instructional",
      "Improved to Independent",
      ...LSEN,
    ]);
  });

  it.each(Object.values(GradeLevelType))(
    "%s always offers both LSEN reasons, last, with a unique key per choice",
    (g) => {
      for (const prev of [null, "NON_DECODER_LOW_EMERGENT", "INDEPENDENT_GRADE_READY", "CVC_BLENDING"]) {
        const c = mosyReasonChoices(g, prev);
        expect(c.slice(-2).map((x) => x.reason)).toEqual([
          "DIAGNOSED_LSEN",
          "RECOMMENDED_LSEN_ASSESSMENT",
        ]);
        expect(new Set(c.map((x) => x.key)).size).toBe(c.length);
        // Never the lowest level, never a legacy grouped reason.
        expect(c.some((x) => x.reason === "IMPROVED_EARLY_GRADES")).toBe(false);
        expect(c.some((x) => x.reason === "IMPROVED_UPPER_GRADES")).toBe(false);
        for (const x of c) {
          if (x.reason === "IMPROVED_READING_LEVEL") expect(x.improvedToLevel).not.toBeNull();
          else expect(x.improvedToLevel).toBeNull();
        }
      }
    }
  );
});

describe("mosyReasonLabel", () => {
  it("renders Improved to <level> with the grade's label", () => {
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "INSTRUCTIONAL_DEVELOPING", "G3")).toBe(
      "Improved to Developing or Transitioning"
    );
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "INSTRUCTIONAL_DEVELOPING", "G11")).toBe(
      "Improved to Instructional Level"
    );
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "CV_BLENDING", "KINDER")).toBe(
      "Improved to Level 2 - CV blending"
    );
  });

  it("falls back to the enum label when the level is missing", () => {
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", null, "G3")).toBe("Improved reading level");
  });

  it("labels legacy and LSEN reasons from the enum map", () => {
    expect(mosyReasonLabel("IMPROVED_EARLY_GRADES", null, "G2")).toBe(
      "Improved to Developing / Transitioning / Grade Ready"
    );
    expect(mosyReasonLabel("IMPROVED_UPPER_GRADES", null, "G6")).toBe(
      "Improved to Instructional / Independent Reader"
    );
    expect(mosyReasonLabel("DIAGNOSED_LSEN", null, "G6")).toMatch(/LSEN/);
  });

  it("every offered choice's label equals mosyReasonLabel for it", () => {
    for (const g of Object.values(GradeLevelType)) {
      for (const c of mosyReasonChoices(g, null)) {
        expect(mosyReasonLabel(c.reason, c.improvedToLevel, g)).toBe(c.label);
      }
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

  it("accepts Improved to a level above the previous one and stores improvedToLevel", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G6" }),
        previousFilipinoLevel: "NON_DECODER_LOW_EMERGENT",
        submitted: {
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "INSTRUCTIONAL_DEVELOPING",
        },
      })
    );
    expect(res.transition).toBe("MOVED_OUT");
    expect(res.row.reason).toBe("IMPROVED_READING_LEVEL");
    expect(res.row.improvedToLevel).toBe("INSTRUCTIONAL_DEVELOPING");
  });

  it("accepts Improved to a Kinder rubric level above the previous one", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        previousFilipinoLevel: "LETTER_LEVEL",
        submitted: {
          mosyLevel: "CV_BLENDING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "CVC_BLENDING",
        },
      })
    );
    expect(res.row.improvedToLevel).toBe("CVC_BLENDING");
  });

  it("nulls improvedToLevel for an LSEN reason even if one is submitted", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: {
          decision: "MOVE_OUT",
          reason: "DIAGNOSED_LSEN",
          improvedToLevel: "INDEPENDENT_GRADE_READY",
        },
      })
    );
    expect(res.row.improvedToLevel).toBeNull();
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

  it("forces improvedToLevel to null for STAY even if one is submitted", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: {
          decision: "STAY",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "INDEPENDENT_GRADE_READY",
        },
      })
    );
    expect(res.row.reason).toBeNull();
    expect(res.row.improvedToLevel).toBeNull();
  });

  it("forces the reason and improvedToLevel to null for a deferred decision", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: {
          decision: null,
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "INDEPENDENT_GRADE_READY",
        },
      })
    );
    expect(res.row.reason).toBeNull();
    expect(res.row.improvedToLevel).toBeNull();
  });

  it("re-tag via STAY clears any saved improvedToLevel", () => {
    const res = expectOk(
      resolve({ learner: untagged(), existing: movedOutRow(), submitted: { decision: "STAY" } })
    );
    expect(res.row.improvedToLevel).toBeNull();
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

  it.each(["IMPROVED_EARLY_GRADES", "IMPROVED_UPPER_GRADES"] as const)(
    "legacy reason %s is REASON_NOT_ALLOWED for every grade",
    (reason) => {
      for (const g of Object.values(GradeLevelType)) {
        const levels: Record<string, ReadingProfile> = {
          KINDER: "LETTER_LEVEL",
        };
        expectFail(
          resolve({
            learner: tagged({ gradeType: g }),
            submitted: {
              mosyLevel: levels[g] ?? "INSTRUCTIONAL_DEVELOPING",
              decision: "MOVE_OUT",
              reason,
            },
          }),
          "REASON_NOT_ALLOWED"
        );
      }
    }
  );

  it("IMPROVED_READING_LEVEL without improvedToLevel is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        previousFilipinoLevel: "NON_DECODER_LOW_EMERGENT",
        submitted: { decision: "MOVE_OUT", reason: "IMPROVED_READING_LEVEL", improvedToLevel: null },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("an LSEN reason with an improvedToLevel is accepted and drops the level (not rejected)", () => {
    const res = expectOk(
      resolve({
        learner: tagged(),
        submitted: {
          decision: "MOVE_OUT",
          reason: "RECOMMENDED_LSEN_ASSESSMENT",
          improvedToLevel: "INDEPENDENT_GRADE_READY",
        },
      })
    );
    expect(res.row.improvedToLevel).toBeNull();
  });

  it.each([
    ["equal to previous", "FRUSTRATION_HIGH_EMERGENT", "FRUSTRATION_HIGH_EMERGENT"],
    ["below previous", "INSTRUCTIONAL_DEVELOPING", "NON_DECODER_LOW_EMERGENT"],
    ["at the top, previous at top", "INDEPENDENT_GRADE_READY", "INDEPENDENT_GRADE_READY"],
  ] as const)("improved level %s is REASON_NOT_ALLOWED", (_n, previous, improvedToLevel) => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        previousFilipinoLevel: previous,
        submitted: { decision: "MOVE_OUT", reason: "IMPROVED_READING_LEVEL", improvedToLevel },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("with no previous level the lowest level is not offered, the next one is", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        previousFilipinoLevel: null,
        submitted: {
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "NON_DECODER_LOW_EMERGENT",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
    expectOk(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        previousFilipinoLevel: null,
        submitted: {
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "FRUSTRATION_HIGH_EMERGENT",
        },
      })
    );
  });

  it("an improved level outside the grade's scale is REASON_NOT_ALLOWED (Kinder rubric level on G4, SHS lowest)", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G4" }),
        submitted: {
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "CVC_BLENDING",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G11" }),
        submitted: {
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "NON_DECODER_LOW_EMERGENT",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("the previous level comes from the input, so the same submission flips with it", () => {
    const submitted = {
      decision: "MOVE_OUT" as const,
      reason: "IMPROVED_READING_LEVEL" as const,
      improvedToLevel: "INSTRUCTIONAL_DEVELOPING" as const,
    };
    expectOk(
      resolve({ learner: tagged(), previousFilipinoLevel: "FRUSTRATION_HIGH_EMERGENT", submitted })
    );
    expectFail(
      resolve({ learner: tagged(), previousFilipinoLevel: "INSTRUCTIONAL_DEVELOPING", submitted }),
      "REASON_NOT_ALLOWED"
    );
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
        reason: "DIAGNOSED_LSEN",
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

  it("drops English for Kinder (Filipino only) and keeps it for G3 (languagesForGrade)", () => {
    const kinder = formatPreviousLevel(
      { ...record, englishProfile: "LETTER_LEVEL", filipinoProfile: "LETTER_LEVEL" },
      "KINDER"
    );
    expect(kinder?.english).toBeNull();
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
