import { describe, expect, it } from "vitest";
import { AralMosyMoveOutReason, AralMosyOutcome, GradeLevelType } from "@prisma/client";
import {
  ARAL_MOSY_MOVE_OUT_REASON_LABELS,
  ARAL_MOSY_OUTCOME_CHOICE_LABELS,
  ARAL_MOSY_OUTCOME_LABELS,
} from "@/lib/constants/enum-labels";
import { mosyReasonChoices } from "@/lib/aral/mosy";

describe("ARAL MOSY enum labels", () => {
  it("labels every AralMosyOutcome value in both maps, and nothing extra", () => {
    const values = Object.values(AralMosyOutcome).sort();
    expect(Object.keys(ARAL_MOSY_OUTCOME_LABELS).sort()).toEqual(values);
    expect(Object.keys(ARAL_MOSY_OUTCOME_CHOICE_LABELS).sort()).toEqual(values);
  });

  it("labels every AralMosyMoveOutReason value, and nothing extra", () => {
    expect(Object.keys(ARAL_MOSY_MOVE_OUT_REASON_LABELS).sort()).toEqual(
      Object.values(AralMosyMoveOutReason).sort()
    );
  });

  it("every label is a non-empty string", () => {
    for (const map of [
      ARAL_MOSY_OUTCOME_LABELS,
      ARAL_MOSY_OUTCOME_CHOICE_LABELS,
      ARAL_MOSY_MOVE_OUT_REASON_LABELS,
    ]) {
      for (const v of Object.values(map)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });

  it("every reason a grade can offer has a label, and never a legacy grouped reason", () => {
    for (const g of Object.values(GradeLevelType)) {
      for (const prev of [null, "NON_DECODER_LOW_EMERGENT", "INDEPENDENT_GRADE_READY"]) {
        for (const c of mosyReasonChoices(g, prev)) {
          expect(ARAL_MOSY_MOVE_OUT_REASON_LABELS[c.reason]).toBeTruthy();
          expect(c.label.trim().length).toBeGreaterThan(0);
          expect(["IMPROVED_EARLY_GRADES", "IMPROVED_UPPER_GRADES"]).not.toContain(c.reason);
        }
      }
    }
  });

  it("keeps a display label for the legacy grouped reasons (old rows still render)", () => {
    expect(ARAL_MOSY_MOVE_OUT_REASON_LABELS.IMPROVED_EARLY_GRADES).toBeTruthy();
    expect(ARAL_MOSY_MOVE_OUT_REASON_LABELS.IMPROVED_UPPER_GRADES).toBeTruthy();
    expect(ARAL_MOSY_MOVE_OUT_REASON_LABELS.IMPROVED_READING_LEVEL).toBeTruthy();
  });
});
