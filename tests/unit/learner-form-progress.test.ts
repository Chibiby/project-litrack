import { describe, expect, it, vi } from "vitest";
import {
  formProgress,
  sectionProgress,
  type FormValues,
} from "@/components/forms/form-sections";

/**
 * The completion arithmetic behind the learner form's section ticks and progress
 * bar, run against the real `LEARNER_FORM_SECTIONS` rather than a stand-in.
 *
 * This is the same computation the submit button uses to decide which collapsed
 * section to open, so a wrong count is not cosmetic: it would let a form submit
 * with an empty required field the teacher never saw, or refuse a complete one.
 *
 * `learner-form.tsx` exports the section list for exactly this; its side of the
 * module — server actions, router, toasts — is mocked away, and nothing renders.
 */

vi.mock("@/lib/actions/learner", () => ({
  createLearner: vi.fn(),
  updateLearner: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));

const { LEARNER_FORM_SECTIONS } = await import(
  "@/components/forms/learner-form"
);

/** Everything the four sections require of an untouched, unconditional form. */
const COMPLETE: FormValues = {
  firstName: "Ana",
  lastName: "Santos",
  age: "10",
  gender: "FEMALE",
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  parentEducation: "COLLEGE_GRADUATE",
};

const IDENTITY_FILLED: FormValues = {
  firstName: "Ana",
  lastName: "Santos",
  age: "10",
  gender: "FEMALE",
};

const sectionByKey = (key: string) => {
  const section = LEARNER_FORM_SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`no section ${key}`);
  return section;
};

describe("LEARNER_FORM_SECTIONS", () => {
  it("divides the DepEd form into the four approved groups, in order", () => {
    expect(LEARNER_FORM_SECTIONS.map((s) => s.key)).toEqual([
      "identity",
      "reading",
      "household",
      "background",
    ]);
    expect(LEARNER_FORM_SECTIONS.map((s) => s.title)).toEqual([
      "Identity & placement",
      "Reading levels",
      "Household & support",
      "Attendance & school background",
    ]);
    // Every section says what belongs in it; a bare title makes the collapsed
    // list unreadable, which is the whole reason for dividing the form.
    for (const section of LEARNER_FORM_SECTIONS) {
      expect(section.hint, section.key).toBeTruthy();
    }
  });

  it("leaves the grade select out of the count", () => {
    // The select is pre-set to the grade the teacher is already in and cannot be
    // empty, so counting it would park an untouched form above zero.
    for (const section of LEARNER_FORM_SECTIONS) {
      expect(section.requiredFields({}), section.key).not.toContain(
        "gradeLevelId"
      );
    }
    expect(formProgress(LEARNER_FORM_SECTIONS, {}).percent).toBe(0);
  });
});

describe("formProgress — the completion bar", () => {
  it("counts required fields, not sections", () => {
    const empty = formProgress(LEARNER_FORM_SECTIONS, {});
    expect(empty).toMatchObject({ filled: 0, total: 7, percent: 0 });

    // Four of seven names, in one of four sections. By section this would read
    // 25%; by field it reads 57%, which is what the teacher has actually done.
    const partial = formProgress(LEARNER_FORM_SECTIONS, IDENTITY_FILLED);
    expect(partial).toMatchObject({ filled: 4, total: 7, percent: 57 });
    expect(partial.incomplete.map((s) => s.key)).toEqual([
      "reading",
      "household",
    ]);
  });

  it("is complete exactly when the server's requirements are met", () => {
    const done = formProgress(LEARNER_FORM_SECTIONS, COMPLETE);
    expect(done).toMatchObject({ filled: 7, total: 7, percent: 100 });
    expect(done.complete).toBe(true);
    expect(done.incomplete).toEqual([]);
  });

  it("calls a form with nothing required complete, not zero percent done", () => {
    // Section 4 alone: optional until a transfer answer creates work.
    const optionalOnly = formProgress(LEARNER_FORM_SECTIONS.slice(3), {});
    expect(optionalOnly).toMatchObject({ total: 0, percent: 100 });
    expect(optionalOnly.complete).toBe(true);
  });

  it("dips when choosing Others adds a name to fill", () => {
    const before = formProgress(LEARNER_FORM_SECTIONS, IDENTITY_FILLED);
    const after = formProgress(LEARNER_FORM_SECTIONS, {
      ...IDENTITY_FILLED,
      ethnicity: "OTHER",
    });

    // Nothing was un-filled; the denominator grew, because the teacher created
    // work by answering. A bar that stayed put would be lying.
    expect(after.filled).toBe(before.filled);
    expect(after.total).toBe(before.total + 1);
    expect(after.percent).toBeLessThan(before.percent);
    expect(after.percent).toBe(50);
    expect(after.incomplete.map((s) => s.key)).toContain("identity");

    const specified = formProgress(LEARNER_FORM_SECTIONS, {
      ...IDENTITY_FILLED,
      ethnicity: "OTHER",
      ethnicityOther: "Aeta",
    });
    expect(specified.incomplete.map((s) => s.key)).not.toContain("identity");
  });

  it("dips again when Multiple transfers is chosen", () => {
    const done = formProgress(LEARNER_FORM_SECTIONS, COMPLETE);
    const transferring = formProgress(LEARNER_FORM_SECTIONS, {
      ...COMPLETE,
      previousTransfers: "MULTIPLE",
    });

    expect(done.complete).toBe(true);
    expect(transferring.complete).toBe(false);
    expect(transferring).toMatchObject({ filled: 7, total: 8, percent: 88 });
    expect(transferring.incomplete.map((s) => s.key)).toEqual(["background"]);

    expect(
      formProgress(LEARNER_FORM_SECTIONS, {
        ...COMPLETE,
        previousTransfers: "MULTIPLE",
        transferDetails: "Two schools before this one",
      }).complete
    ).toBe(true);
  });
});

describe("sectionProgress — the per-section tick", () => {
  it("ticks a section only once every name it requires is filled", () => {
    const identity = sectionByKey("identity");
    expect(sectionProgress(identity, {})).toMatchObject({
      required: 4,
      filled: 0,
      complete: false,
      optional: false,
    });
    expect(sectionProgress(identity, { firstName: "Ana" }).missing).toEqual([
      "lastName",
      "age",
      "gender",
    ]);
    expect(sectionProgress(identity, IDENTITY_FILLED).complete).toBe(true);
  });

  it("marks section four optional rather than ticked", () => {
    // A tick before the teacher has opened a section reads as "already done",
    // which is why an empty requirement list gets the Optional chip instead.
    const background = sectionProgress(sectionByKey("background"), {});
    expect(background.optional).toBe(true);
    expect(background.required).toBe(0);
    expect(background.missing).toEqual([]);
  });

  it("stops being optional once a transfer answer requires the detail", () => {
    const background = sectionByKey("background");
    const chosen = sectionProgress(background, {
      previousTransfers: "MULTIPLE",
    });
    expect(chosen).toMatchObject({
      required: 1,
      filled: 0,
      optional: false,
      complete: false,
    });
    expect(chosen.missing).toEqual(["transferDetails"]);

    // "None" and "One" ask for nothing further, so the section is optional again.
    for (const answer of ["NONE", "ONE"]) {
      expect(
        sectionProgress(background, { previousTransfers: answer }).optional,
        answer
      ).toBe(true);
    }
  });

  it("counts only what is required, ignoring the optional fields around it", () => {
    // Section B carries transport, distance, and transfers; none of them counts
    // until the conditional detail appears, so filling them moves nothing.
    const background = sectionByKey("background");
    expect(
      sectionProgress(background, {
        modeOfTransportation: "WALKING",
        distanceHomeToSchool: "LESS_THAN_1KM",
      })
    ).toMatchObject({ required: 0, filled: 0, optional: true, complete: true });
  });
});
