import { describe, expect, it } from "vitest";
import {
  IP_ETHNICITIES,
  ipKindsOf,
  isIpEthnicity,
  isIpLearner,
} from "@/lib/ip/ethnicity";

describe("IP ethnicity classification", () => {
  it("defines exactly the seven IP groups", () => {
    expect([...IP_ETHNICITIES].sort()).toEqual(
      ["BADJAO", "BLAAN", "MAGUINDANAON", "MARANAO", "TAGAKAOLO", "TAUSOG", "TBOLI"].sort()
    );
  });

  it("classifies single values", () => {
    expect(isIpEthnicity("TBOLI")).toBe(true);
    for (const v of ["BISAYA", "ILONGGO", "ILOCANO", "TAGALOG", "FOREIGN", "OTHER"]) {
      expect(isIpEthnicity(v)).toBe(false);
    }
    expect(isIpEthnicity(null)).toBe(false);
    expect(isIpEthnicity(undefined)).toBe(false);
  });

  it("treats a learner as IP when either slot is IP", () => {
    expect(isIpLearner("BLAAN", null)).toBe(true);
    expect(isIpLearner("BISAYA", "MARANAO")).toBe(true);
    expect(isIpLearner("BISAYA", "TAGALOG")).toBe(false);
    expect(isIpLearner(null, null)).toBe(false);
  });

  it("returns distinct IP kinds across both slots", () => {
    expect(ipKindsOf("BLAAN", "TBOLI")).toEqual(["BLAAN", "TBOLI"]);
    expect(ipKindsOf("BLAAN", "BLAAN")).toEqual(["BLAAN"]);
    expect(ipKindsOf("OTHER", "TAUSOG")).toEqual(["TAUSOG"]);
  });
});
