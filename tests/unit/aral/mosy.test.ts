import { describe, expect, it } from "vitest";
import { GradeLevelType } from "@prisma/client";
import type { AralMosyOutcome, ReadingProfile } from "@prisma/client";
import { labelReadingProfile } from "@/lib/constants/enum-labels";
import { readingProfileOptionsForGrade } from "@/lib/reading/policy";
import {
  MOSY_STATUSES,
  computeMosyStats,
  formatBosyLevel,
  mosyLevelLanguage,
  mosyLevelOptions,
  mosyReasonChoices,
  mosyReasonLabel,
  mosyRowStatus,
  mosyTransferLevelOptions,
  parseMosyStatus,
  resolveMosySave,
  type MosySaveInput,
} from "@/lib/aral/mosy";

describe("mosyLevelLanguage", () => {
  it.each(["KINDER", "G1", "G2"])("%s reads in Filipino", (g) => {
    expect(mosyLevelLanguage(g)).toBe("FILIPINO");
  });
  it.each(["G3", "G6", "G10", "G12", "FLOATING"])("%s reads in English", (g) => {
    expect(mosyLevelLanguage(g)).toBe("ENGLISH");
  });
});

/**
 * Pure decision layer for the MOSY Report. Spec:
 * docs/superpowers/specs/2026-09-29-mosy-report-page-design.md sections 2.5 and 7.
 *
 * The headline invariant is "changing the level never untags": every level-change
 * case below asserts `learnerPatch === null`, and the only inputs that may produce
 * a patch are MOVE_OUT on a tagged learner and STAY on an untagged one.
 */

const ACTOR = "tutor-1";
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
// Default level is one the G4 learner may use for the decision: the stay levels
// for STAY / no decision, a move-out level for MOVE_OUT.
const submit = (over: Partial<Submitted> = {}): Submitted => ({
  mosyLevel:
    over.decision === "MOVE_OUT" ? "INSTRUCTIONAL_DEVELOPING" : "NON_DECODER_LOW_EMERGENT",
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
  bosyFilipinoLevel?: string | null;
}) {
  return resolveMosySave({
    actorId: args.actorId ?? ACTOR,
    now: NOW,
    learner: args.learner,
    existing: args.existing ?? null,
    submitted: submit(args.submitted),
    bosyFilipinoLevel: args.bosyFilipinoLevel ?? null,
  });
}

function expectFail(res: ReturnType<typeof resolveMosySave>, failure: string) {
  expect(res).toEqual({ ok: false, failure });
}

function expectOk(res: ReturnType<typeof resolveMosySave>) {
  if (!res.ok) throw new Error(`expected ok, got ${res.failure}`);
  return res;
}

describe("mosyLevelOptions", () => {
  const values = (g: string, d: AralMosyOutcome | null) =>
    mosyLevelOptions(g, d).map((o) => o.value);
  const labelsOf = (g: string, d: AralMosyOutcome | null) =>
    mosyLevelOptions(g, d).map((o) => o.label);

  it.each(["G1", "G2", "G3"])("%s: STAY or no decision offers the two lowest levels", (g) => {
    for (const d of ["STAY", null] as const) {
      expect(values(g, d)).toEqual(["NON_DECODER_LOW_EMERGENT", "FRUSTRATION_HIGH_EMERGENT"]);
    }
    expect(labelsOf(g, "STAY")).toEqual(["Low Emergent", "High Emergent"]);
  });

  it.each(["G1", "G2", "G3"])("%s: MOVE_OUT offers Developing, Transitioning, Grade-level Ready", (g) => {
    expect(values(g, "MOVE_OUT")).toEqual(["DEVELOPING", "TRANSITIONING", "INDEPENDENT_GRADE_READY"]);
    expect(labelsOf(g, "MOVE_OUT")).toEqual(["Developing", "Transitioning", "Grade-level Ready"]);
  });

  it.each(["G4", "G5", "G6", "G7", "G8", "G9", "G10"])(
    "%s: STAY or no decision offers the two lowest levels, MOVE_OUT the two highest",
    (g) => {
      for (const d of ["STAY", null] as const) {
        expect(values(g, d)).toEqual(["NON_DECODER_LOW_EMERGENT", "FRUSTRATION_HIGH_EMERGENT"]);
      }
      expect(values(g, "MOVE_OUT")).toEqual(["INSTRUCTIONAL_DEVELOPING", "INDEPENDENT_GRADE_READY"]);
      expect(labelsOf(g, "MOVE_OUT")).toEqual(["Instructional", "Independent"]);
    }
  );

  it.each(["KINDER", "G11", "G12", "FLOATING"])(
    "%s: the whole scale for every decision, unchanged",
    (g) => {
      const scale = readingProfileOptionsForGrade(g);
      for (const d of ["STAY", "MOVE_OUT", null] as const) {
        expect(mosyLevelOptions(g, d)).toEqual(scale);
      }
    }
  );

  it("every option's value and label come from the grade's own scale", () => {
    for (const g of Object.values(GradeLevelType)) {
      const scale = readingProfileOptionsForGrade(g);
      for (const d of ["STAY", "MOVE_OUT", null] as const) {
        for (const o of mosyLevelOptions(g, d)) expect(scale).toContainEqual(o);
      }
    }
  });
});

describe("mosyTransferLevelOptions", () => {
  it("G1 to G3: the whole scale without the legacy combined level", () => {
    for (const g of ["G1", "G2", "G3"]) {
      expect(mosyTransferLevelOptions(g).map((o) => o.value)).toEqual([
        "NON_DECODER_LOW_EMERGENT",
        "FRUSTRATION_HIGH_EMERGENT",
        "DEVELOPING",
        "TRANSITIONING",
        "INDEPENDENT_GRADE_READY",
      ]);
    }
  });

  it("G4 to G10: the whole scale, Instructional is not legacy there", () => {
    expect(mosyTransferLevelOptions("G5").map((o) => o.value)).toEqual(
      readingProfileOptionsForGrade("G5").map((o) => o.value)
    );
    expect(mosyTransferLevelOptions("G5").map((o) => o.value)).toContain("INSTRUCTIONAL_DEVELOPING");
  });
});

describe("mosyReasonChoices", () => {
  const labels = (g: string, prev: string | null) =>
    mosyReasonChoices(g, prev).map((c) => c.label);
  const LSEN = [
    "Diagnosed as Learner with Special Educational Needs (LSEN)",
    "Recommended for LSEN assessment",
    "Transferred out",
  ];

  it.each(["G1", "G2", "G3"])(
    "%s offers the three move-out levels whatever the BOSY level",
    (g) => {
      const expected = [
        "Improved to Developing",
        "Improved to Transitioning",
        "Improved to Grade-level Ready",
        ...LSEN,
      ];
      for (const bosy of [
        null,
        "NON_DECODER_LOW_EMERGENT",
        "FRUSTRATION_HIGH_EMERGENT",
        "DEVELOPING",
        "INDEPENDENT_GRADE_READY",
        "INSTRUCTIONAL_DEVELOPING",
      ]) {
        expect(labels(g, bosy)).toEqual(expected);
      }
      expect(
        mosyReasonChoices(g, null)
          .filter((x) => x.reason === "IMPROVED_READING_LEVEL")
          .map((x) => x.improvedToLevel)
      ).toEqual(["DEVELOPING", "TRANSITIONING", "INDEPENDENT_GRADE_READY"]);
    }
  );

  it.each(["G4", "G5", "G6", "G10"])(
    "%s offers Instructional and Independent whatever the BOSY level",
    (g) => {
      const expected = ["Improved to Instructional", "Improved to Independent", ...LSEN];
      for (const bosy of [null, "NON_DECODER_LOW_EMERGENT", "INDEPENDENT_GRADE_READY", "LETTER_LEVEL"]) {
        expect(labels(g, bosy)).toEqual(expected);
      }
    }
  );

  it.each(["G1", "G5", "G11", "KINDER", "FLOATING"])(
    "%s ends with Transferred out, after the two LSEN reasons",
    (g) => {
      const c = mosyReasonChoices(g, null);
      expect(c.at(-1)).toEqual({
        key: "TRANSFERRED_OUT",
        reason: "TRANSFERRED_OUT",
        improvedToLevel: null,
        label: "Transferred out",
      });
      expect(c.slice(-3, -1).map((x) => x.reason)).toEqual([
        "DIAGNOSED_LSEN",
        "RECOMMENDED_LSEN_ASSESSMENT",
      ]);
    }
  );

  it("an off-band grade (SHS) with BOSY at the top offers no improvement, only LSEN and Transferred out", () => {
    const c = mosyReasonChoices("G11", "INDEPENDENT_GRADE_READY");
    expect(c.map((x) => x.reason)).toEqual([
      "DIAGNOSED_LSEN",
      "RECOMMENDED_LSEN_ASSESSMENT",
      "TRANSFERRED_OUT",
    ]);
    expect(c.every((x) => x.improvedToLevel === null)).toBe(true);
  });

  it("an off-band grade (floating) with no BOSY level offers every level but the lowest", () => {
    // 2 improved levels + 2 LSEN reasons + Transferred out
    expect(labels("FLOATING", null)).toHaveLength(5 + 1);
    expect(
      mosyReasonChoices("FLOATING", "FRUSTRATION_HIGH_EMERGENT")
        .filter((x) => x.improvedToLevel)
        .map((x) => x.improvedToLevel)
    ).toEqual(["INSTRUCTIONAL_DEVELOPING", "INDEPENDENT_GRADE_READY"]);
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

  it("G4 to G10 use the PHIL-IRI band labels", () => {
    expect(labels("G6", "NON_DECODER_LOW_EMERGENT")).toEqual([
      "Improved to Instructional",
      "Improved to Independent",
      ...LSEN,
    ]);
  });

  it.each(Object.values(GradeLevelType))(
    "%s always offers both LSEN reasons and Transferred out, last, with a unique key per choice",
    (g) => {
      for (const prev of [null, "NON_DECODER_LOW_EMERGENT", "INDEPENDENT_GRADE_READY", "CVC_BLENDING"]) {
        const c = mosyReasonChoices(g, prev);
        expect(c.slice(-3).map((x) => x.reason)).toEqual([
          "DIAGNOSED_LSEN",
          "RECOMMENDED_LSEN_ASSESSMENT",
          "TRANSFERRED_OUT",
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
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "DEVELOPING", "G3")).toBe(
      "Improved to Developing"
    );
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "TRANSITIONING", "G3")).toBe(
      "Improved to Transitioning"
    );
    // A row saved before the split keeps its old level, flagged for update.
    expect(mosyReasonLabel("IMPROVED_READING_LEVEL", "INSTRUCTIONAL_DEVELOPING", "G3")).toBe(
      "Improved to Developing or Transitioning — needs update"
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
    expect(mosyReasonLabel("TRANSFERRED_OUT", null, "G6")).toBe("Transferred out");
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
  // G4: the levels offered for STAY / no decision.
  const levels: ReadingProfile[] = ["NON_DECODER_LOW_EMERGENT", "FRUSTRATION_HIGH_EMERGENT"];

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
        submitted: { mosyLevel: "FRUSTRATION_HIGH_EMERGENT", decision: "STAY" },
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

  it("accepts Improved to X when the MOSY level is X and stores improvedToLevel", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G6" }),
        bosyFilipinoLevel: "NON_DECODER_LOW_EMERGENT",
        submitted: {
          mosyLevel: "INSTRUCTIONAL_DEVELOPING",
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

  it.each(["G1", "G3"])(
    "%s: Improved to Transitioning with MOSY level Transitioning, whatever the BOSY level",
    (g) => {
      const res = expectOk(
        resolve({
          learner: tagged({ gradeType: g }),
          bosyFilipinoLevel: "INDEPENDENT_GRADE_READY",
          submitted: {
            mosyLevel: "TRANSITIONING",
            decision: "MOVE_OUT",
            reason: "IMPROVED_READING_LEVEL",
            improvedToLevel: "TRANSITIONING",
          },
        })
      );
      expect(res.row.improvedToLevel).toBe("TRANSITIONING");
    }
  );

  it("accepts Improved to a Kinder rubric level above the BOSY one", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        bosyFilipinoLevel: "LETTER_LEVEL",
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
          mosyLevel: "INSTRUCTIONAL_DEVELOPING",
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

describe("resolveMosySave — Transferred out", () => {
  it("G3: MOVE_OUT + TRANSFERRED_OUT saves at Low Emergent (a stay level) and moves the learner out", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: {
          mosyLevel: "NON_DECODER_LOW_EMERGENT",
          decision: "MOVE_OUT",
          reason: "TRANSFERRED_OUT",
          improvedToLevel: "DEVELOPING",
        },
      })
    );
    expect(res.transition).toBe("MOVED_OUT");
    expect(res.row).toMatchObject({
      mosyLevel: "NON_DECODER_LOW_EMERGENT",
      decision: "MOVE_OUT",
      reason: "TRANSFERRED_OUT",
      improvedToLevel: null,
    });
  });

  it("G5: MOVE_OUT + TRANSFERRED_OUT saves at Frustration", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G5" }),
        submitted: {
          mosyLevel: "FRUSTRATION_HIGH_EMERGENT",
          decision: "MOVE_OUT",
          reason: "TRANSFERRED_OUT",
        },
      })
    );
    expect(res.row.reason).toBe("TRANSFERRED_OUT");
    expect(res.row.improvedToLevel).toBeNull();
  });

  it("G3: DIAGNOSED_LSEN at Low Emergent is still LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: { mosyLevel: "NON_DECODER_LOW_EMERGENT", decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("G3: IMPROVED_READING_LEVEL at Low Emergent is still LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: {
          mosyLevel: "NON_DECODER_LOW_EMERGENT",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "DEVELOPING",
        },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("G3: TRANSFERRED_OUT with the legacy combined level is LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: { mosyLevel: "INSTRUCTIONAL_DEVELOPING", decision: "MOVE_OUT", reason: "TRANSFERRED_OUT" },
      }),
      "LEVEL_NOT_ALLOWED"
    );
  });

  it("a Stay level on a STAY decision stays valid and carries no reason", () => {
    const res = expectOk(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: { mosyLevel: "NON_DECODER_LOW_EMERGENT", decision: "STAY", reason: "TRANSFERRED_OUT" },
      })
    );
    expect(res.row.reason).toBeNull();
  });

  it("G3: a transfer-out level outside the grade scale is LEVEL_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: { mosyLevel: "LETTER_LEVEL", decision: "MOVE_OUT", reason: "TRANSFERRED_OUT" },
      }),
      "LEVEL_NOT_ALLOWED"
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
          // Grade 1-3 no longer accept the combined INSTRUCTIONAL_DEVELOPING.
          G1: "DEVELOPING",
          G2: "DEVELOPING",
          G3: "DEVELOPING",
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
        bosyFilipinoLevel: "NON_DECODER_LOW_EMERGENT",
        submitted: {
          mosyLevel: "DEVELOPING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: null,
        },
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
    ["Improved to Developing but MOSY level Transitioning", "TRANSITIONING", "DEVELOPING"],
    ["Improved to Grade-level Ready but MOSY level Developing", "DEVELOPING", "INDEPENDENT_GRADE_READY"],
  ] as const)("G3: %s is REASON_NOT_ALLOWED", (_n, mosyLevel, improvedToLevel) => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: { mosyLevel, decision: "MOVE_OUT", reason: "IMPROVED_READING_LEVEL", improvedToLevel },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("G6: Improved to Independent but MOSY level Instructional is REASON_NOT_ALLOWED", () => {
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G6" }),
        submitted: {
          mosyLevel: "INSTRUCTIONAL_DEVELOPING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "INDEPENDENT_GRADE_READY",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it("G1 to G10: an improved level that is not a move-out level is REASON_NOT_ALLOWED", () => {
    // Low Emergent is a stay level, never offered as "Improved to".
    expectFail(
      resolve({
        learner: tagged({ gradeType: "G3" }),
        submitted: {
          mosyLevel: "DEVELOPING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "NON_DECODER_LOW_EMERGENT",
        },
      }),
      "REASON_NOT_ALLOWED"
    );
  });

  it.each(["G1", "G2", "G3", "G4", "G10"])(
    "%s: an LSEN reason is allowed with every move-out level",
    (g) => {
      for (const o of mosyLevelOptions(g, "MOVE_OUT")) {
        for (const reason of ["DIAGNOSED_LSEN", "RECOMMENDED_LSEN_ASSESSMENT"] as const) {
          const res = expectOk(
            resolve({
              learner: tagged({ gradeType: g }),
              submitted: { mosyLevel: o.value as ReadingProfile, decision: "MOVE_OUT", reason },
            })
          );
          expect(res.row.mosyLevel).toBe(o.value);
        }
      }
    }
  );

  it.each(["G1", "G3", "G4", "G10"])(
    "%s: a stay level on a MOVE_OUT, and a move-out level on STAY or no decision, is LEVEL_NOT_ALLOWED",
    (g) => {
      const learner = tagged({ gradeType: g });
      expectFail(
        resolve({
          learner,
          submitted: { mosyLevel: "NON_DECODER_LOW_EMERGENT", decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" },
        }),
        "LEVEL_NOT_ALLOWED"
      );
      expectFail(
        resolve({
          learner,
          submitted: { mosyLevel: "INDEPENDENT_GRADE_READY", decision: "STAY" },
        }),
        "LEVEL_NOT_ALLOWED"
      );
      expectFail(
        resolve({
          learner,
          submitted: { mosyLevel: "INDEPENDENT_GRADE_READY", decision: null },
        }),
        "LEVEL_NOT_ALLOWED"
      );
    }
  );

  it("G1 to G3 refuse the legacy combined level on every decision", () => {
    for (const decision of ["STAY", "MOVE_OUT", null] as const) {
      expectFail(
        resolve({
          learner: tagged({ gradeType: "G2" }),
          submitted: {
            mosyLevel: "INSTRUCTIONAL_DEVELOPING",
            decision,
            reason: decision === "MOVE_OUT" ? "DIAGNOSED_LSEN" : null,
          },
        }),
        "LEVEL_NOT_ALLOWED"
      );
    }
  });

  it("off-band grades keep the whole scale for every decision", () => {
    expectOk(
      resolve({
        learner: tagged({ gradeType: "G11" }),
        submitted: { mosyLevel: "INDEPENDENT_GRADE_READY", decision: "STAY" },
      })
    );
    expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        submitted: { mosyLevel: "CVC_BLENDING", decision: null },
      })
    );
  });

  it("an off-band grade is not held to Improved to X = MOSY level X", () => {
    expectOk(
      resolve({
        learner: tagged({ gradeType: "KINDER" }),
        bosyFilipinoLevel: "LETTER_LEVEL",
        submitted: {
          mosyLevel: "CV_BLENDING",
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: "CVC_BLENDING",
        },
      })
    );
  });

  it("off-band grades still filter Improved to by the BOSY level, and the input flips it", () => {
    const submitted = {
      mosyLevel: "INDEPENDENT_GRADE_READY" as const,
      decision: "MOVE_OUT" as const,
      reason: "IMPROVED_READING_LEVEL" as const,
      improvedToLevel: "INSTRUCTIONAL_DEVELOPING" as const,
    };
    expectOk(
      resolve({ learner: tagged({ gradeType: "G11" }), bosyFilipinoLevel: "FRUSTRATION_HIGH_EMERGENT", submitted })
    );
    expectFail(
      resolve({ learner: tagged({ gradeType: "G11" }), bosyFilipinoLevel: "INSTRUCTIONAL_DEVELOPING", submitted }),
      "REASON_NOT_ALLOWED"
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

// Scope (advisory section) is no longer decided by resolveMosySave: see
// tests/unit/aral/mosy-scope-parity.test.ts and tests/unit/actions/aral-mosy-save.test.ts.

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

describe("formatBosyLevel", () => {
  const learner = {
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "FRUSTRATION_HIGH_EMERGENT",
  };

  it("shows both languages for G4, labelled by the grade", () => {
    expect(formatBosyLevel(learner, "G4")).toEqual({
      filipino: labelReadingProfile("FRUSTRATION_HIGH_EMERGENT", "G4"),
      english: labelReadingProfile("INSTRUCTIONAL_DEVELOPING", "G4"),
    });
  });

  it.each(["G1", "G2"])("drops English for %s even when the learner has one", (g) => {
    const out = formatBosyLevel(learner, g);
    expect(out.english).toBeNull();
    expect(out.filipino).toBeTruthy();
  });

  it("drops English for Kinder (Filipino only) and keeps it for G3 (languagesForGrade)", () => {
    const kinder = formatBosyLevel(
      { englishReadingProfile: "LETTER_LEVEL", filipinoReadingProfile: "LETTER_LEVEL" },
      "KINDER"
    );
    expect(kinder.english).toBeNull();
    expect(kinder.filipino).toBeTruthy();
    expect(formatBosyLevel(learner, "G3").english).toBeTruthy();
  });

  it("null profiles stay null and there is no month", () => {
    const out = formatBosyLevel({ englishReadingProfile: null, filipinoReadingProfile: null }, "G4");
    expect(out).toEqual({ filipino: null, english: null });
  });

  it("a Grade 1-3 legacy combined level reads 'needs update'", () => {
    const out = formatBosyLevel(
      { englishReadingProfile: null, filipinoReadingProfile: "INSTRUCTIONAL_DEVELOPING" },
      "G2"
    );
    expect(out.filipino).toBe("Developing or Transitioning — needs update");
  });
});
