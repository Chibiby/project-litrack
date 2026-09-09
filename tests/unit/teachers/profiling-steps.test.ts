import { describe, it, expect } from "vitest";
import {
  TEACHER_PROFILING_STEPS,
  visibleTeacherStepIndexes,
  visibleTeacherSteps,
  nextTeacherStep,
  previousTeacherStep,
  isLastTeacherStep,
  visiblePositionOf,
} from "@/lib/teachers/profiling-steps";

const TEACHER = false;
const VOLUNTEER = true;

describe("visibleTeacherStepIndexes", () => {
  it("gives a teacher every step in canonical order", () => {
    expect(visibleTeacherStepIndexes(TEACHER)).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops Teaching Assignment for a self-declared ARAL volunteer", () => {
    expect(visibleTeacherStepIndexes(VOLUNTEER)).toEqual([0, 1, 3, 4]);
  });

  it("keeps the canonical index of the steps that survive, so field→step lookups still resolve", () => {
    // Training is canonical index 3 for both. If the volunteer list renumbered
    // it to 2, STEP_FIELDS and stepOfField would validate the wrong fields.
    const visible = visibleTeacherStepIndexes(VOLUNTEER);
    expect(TEACHER_PROFILING_STEPS[visible[2]].id).toBe("training");
    expect(TEACHER_PROFILING_STEPS[visible[3]].id).toBe("review");
  });
});

describe("visibleTeacherSteps", () => {
  it("returns five steps for a teacher, ending at review", () => {
    const steps = visibleTeacherSteps(TEACHER);
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.id)).toEqual([
      "respondent",
      "professional",
      "assignment",
      "training",
      "review",
    ]);
  });

  it("returns four steps for a volunteer, with no assignment step", () => {
    const steps = visibleTeacherSteps(VOLUNTEER);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.id)).not.toContain("assignment");
  });

  it("carries the labels the stepper renders", () => {
    expect(visibleTeacherSteps(VOLUNTEER)[0]).toMatchObject({
      id: "respondent",
      shortLabel: "Respondent",
      title: "Respondent Information",
    });
  });
});

describe("visiblePositionOf", () => {
  it("is the canonical index for a teacher", () => {
    expect(visiblePositionOf(3, TEACHER)).toBe(3);
  });

  it("shifts down past the removed step for a volunteer", () => {
    expect(visiblePositionOf(0, VOLUNTEER)).toBe(0);
    expect(visiblePositionOf(1, VOLUNTEER)).toBe(1);
    expect(visiblePositionOf(3, VOLUNTEER)).toBe(2);
    expect(visiblePositionOf(4, VOLUNTEER)).toBe(3);
  });

  it("returns 0 for a step this person never sees, rather than -1", () => {
    // A -1 would light no step in the rail and read as a broken progress bar.
    expect(visiblePositionOf(2, VOLUNTEER)).toBe(0);
  });
});

describe("nextTeacherStep", () => {
  it("walks a teacher through every step", () => {
    expect(nextTeacherStep(0, TEACHER)).toBe(1);
    expect(nextTeacherStep(1, TEACHER)).toBe(2);
    expect(nextTeacherStep(2, TEACHER)).toBe(3);
    expect(nextTeacherStep(3, TEACHER)).toBe(4);
  });

  it("skips Teaching Assignment for a volunteer", () => {
    expect(nextTeacherStep(1, VOLUNTEER)).toBe(3);
  });

  it("stays put on the last step", () => {
    expect(nextTeacherStep(4, TEACHER)).toBe(4);
    expect(nextTeacherStep(4, VOLUNTEER)).toBe(4);
  });
});

describe("previousTeacherStep", () => {
  it("walks a teacher back one step at a time", () => {
    expect(previousTeacherStep(3, TEACHER)).toBe(2);
  });

  it("skips Teaching Assignment on the way back for a volunteer", () => {
    expect(previousTeacherStep(3, VOLUNTEER)).toBe(1);
  });

  it("stays put on the first step", () => {
    expect(previousTeacherStep(0, TEACHER)).toBe(0);
    expect(previousTeacherStep(0, VOLUNTEER)).toBe(0);
  });
});

describe("isLastTeacherStep", () => {
  it("is true only on review", () => {
    expect(isLastTeacherStep(3, TEACHER)).toBe(false);
    expect(isLastTeacherStep(4, TEACHER)).toBe(true);
    expect(isLastTeacherStep(3, VOLUNTEER)).toBe(false);
    expect(isLastTeacherStep(4, VOLUNTEER)).toBe(true);
  });
});
