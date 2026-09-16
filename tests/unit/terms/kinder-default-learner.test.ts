import { describe, it, expect } from "vitest";
import {
  resolveDefaultKinderLearnerId,
  kinderLearnerPosition,
} from "@/components/terms/kinder-default-learner";

/**
 * Owner bug: the Kinder checklist landed on "Select a learner above" when
 * `?learner=` was missing, instead of opening the roster's first learner
 * ("Juan dela Cruz · 1 of 25" in the mockup). These are the two pure pieces
 * of that decision, extracted so they can be tested without a database.
 */

const ROSTER = [
  { id: "ana", fullName: "Ana Abad" },
  { id: "ben", fullName: "Ben Cruz" },
  { id: "cara", fullName: "Cara Diaz" },
];

describe("resolveDefaultKinderLearnerId", () => {
  it("opens the roster's first learner when no learner is requested", () => {
    expect(resolveDefaultKinderLearnerId(ROSTER, undefined)).toBe("ana");
    expect(resolveDefaultKinderLearnerId(ROSTER, null)).toBe("ana");
  });

  it("keeps a requested learner who is in the roster", () => {
    expect(resolveDefaultKinderLearnerId(ROSTER, "ben")).toBe("ben");
  });

  it("falls back to the first learner when the requested id is not in this roster", () => {
    expect(resolveDefaultKinderLearnerId(ROSTER, "someone-elses-id")).toBe("ana");
  });

  it("returns null for an empty roster", () => {
    expect(resolveDefaultKinderLearnerId([], "anything")).toBeNull();
    expect(resolveDefaultKinderLearnerId([], null)).toBeNull();
  });
});

describe("kinderLearnerPosition", () => {
  it("is 1-based", () => {
    expect(kinderLearnerPosition(ROSTER, "ana")).toBe(1);
    expect(kinderLearnerPosition(ROSTER, "ben")).toBe(2);
    expect(kinderLearnerPosition(ROSTER, "cara")).toBe(3);
  });

  it("is null when there is no open learner, or the learner is not in this roster", () => {
    expect(kinderLearnerPosition(ROSTER, null)).toBeNull();
    expect(kinderLearnerPosition(ROSTER, "not-here")).toBeNull();
  });
});
