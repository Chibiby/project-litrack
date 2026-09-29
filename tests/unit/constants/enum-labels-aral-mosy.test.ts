import { describe, expect, it } from "vitest";
import { AralMosyMoveOutReason, AralMosyOutcome } from "@prisma/client";
import {
  ARAL_MOSY_MOVE_OUT_REASON_LABELS,
  ARAL_MOSY_OUTCOME_CHOICE_LABELS,
  ARAL_MOSY_OUTCOME_LABELS,
} from "@/lib/constants/enum-labels";
import { mosyMoveOutReasonsForGrade } from "@/lib/aral/mosy";

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

  it("every reason a grade can offer has a label", () => {
    for (const g of ["KINDER", "G1", "G4", "G11", "FLOATING"]) {
      for (const r of mosyMoveOutReasonsForGrade(g)) {
        expect(ARAL_MOSY_MOVE_OUT_REASON_LABELS[r]).toBeTruthy();
      }
    }
  });
});
