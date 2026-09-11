import { describe, expect, it } from "vitest";
import { teacherProfileSchema } from "@/lib/validators/profile.schema";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { aralTutorScope } from "@/lib/teachers/aral-tutor";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";

/**
 * §5 of the ten concerns: the floating teacher — a DepEd teacher with no
 * advisory section.
 *
 * The design's central claim is that floating needs no flag and no migration,
 * because with multi-advisory in place it IS zero live advisory sections. That
 * is only safe if nothing anywhere stores it, so the first thing this file pins
 * is that the profile schema's `advisoryMode: "FLOATING"` is a declared choice
 * that lifts a requirement and is never written down. A stored flag could disagree
 * with the sections themselves, and then neither would be authoritative.
 *
 * The second is that the exemption is DISTINCT from the ARAL Volunteer's. Both
 * lift the same two requirements, but they are different facts about different
 * people: a volunteer holds no classroom role at all, a floating DepEd teacher
 * holds one and has no section for it yet. If the only way to finish profiling
 * without a section were to claim to be a volunteer, the designation column
 * would fill up with people who are not volunteers.
 */

const BASE = {
  firstName: "Marivic",
  lastName: "Cruz",
  designation: "Teacher",
  position: "TEACHER_III",
  educationalAttainment: "BACHELORS",
  fieldOfSpecialization: "ENGLISH",
  yearsInService: 4,
  hasReadingTraining: false,
  readingTrainings: [],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "DIVISION",
} as const;

describe("teacherProfileSchema — the floating declaration", () => {
  it("refuses a DepEd teacher who submits no section and declares nothing", () => {
    // Unchanged behaviour, and the reason §5 exists: before the declaration
    // there was no way past this at all, so a teacher without a section could
    // not finish profiling.
    const result = teacherProfileSchema.safeParse(BASE);

    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.errors.map((e) => e.path.join("."));
    expect(paths).toContain("sectionId");
    expect(paths).toContain("currentGradeAssignment");
  });

  it("accepts one who declares they have no advisory section yet", () => {
    const result = teacherProfileSchema.safeParse({
      ...BASE,
      advisoryMode: "FLOATING",
    });

    expect(result.success).toBe(true);
  });

  it("refuses a declaration that also names a section", () => {
    // Contradictory input. Honouring either half silently would make the form
    // lie about what was saved.
    const result = teacherProfileSchema.safeParse({
      ...BASE,
      advisoryMode: "FLOATING",
      sectionId: "11111111-1111-4111-8111-111111111111",
      currentGradeAssignment: "G3",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.errors.map((e) => e.path.join("."))).toContain(
      "sectionId"
    );
  });

  it("defaults to DEFAULT, so an old client cannot float a teacher by omission", () => {
    // The field is new. A tab left open across the deploy posts nothing for it,
    // and must get the old behaviour — a refusal — rather than silently
    // clearing the teacher's advisory.
    const parsed = teacherProfileSchema.safeParse({
      ...BASE,
      sectionId: "11111111-1111-4111-8111-111111111111",
      currentGradeAssignment: "G3",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.advisoryMode).toBe("DEFAULT");
  });

  it("still accepts an ARAL Volunteer without the declaration", () => {
    // The volunteer's exemption comes from the designation and is untouched:
    // two routes to the same lifted requirement, because they describe two
    // different people.
    const result = teacherProfileSchema.safeParse({
      ...BASE,
      designation: ARAL_VOLUNTEER_DESIGNATION,
      position: undefined,
    });

    expect(result.success).toBe(true);
  });

  it("is not persisted — the schema carries it, TeacherProfile does not", () => {
    const parsed = teacherProfileSchema.safeParse({
      ...BASE,
      advisoryMode: "FLOATING",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Present in the parsed input...
    expect(parsed.data).toHaveProperty("advisoryMode");
    // ...and `saveTeacherProfile` destructures it out before the upsert, which
    // `tests/unit/actions/teacher-profile-save.test.ts` asserts against the
    // actual write. Stated here so the two halves of the rule sit together.
    expect(parsed.data.sectionId).toBeUndefined();
    expect(parsed.data.currentGradeAssignment).toBeUndefined();
  });
});

describe("aralTutorScope — a floating teacher may still tutor", () => {
  /**
   * Point 2 of §5: "Already true and must stay true." This is the test the
   * design asked for. `aralTutorScope` is what makes an ARAL-only teacher work
   * at all, and adding an advisory requirement to it would silently undo the
   * whole concern.
   */
  it("requires no advisory section of any kind", () => {
    const where = aralTutorScope("school-malandag");

    expect(where).toEqual({
      schoolId: "school-malandag",
      role: "TEACHER",
      deletedAt: null,
      isActive: true,
      approvalStatus: "APPROVED",
    });
    const serialized = JSON.stringify(where);
    expect(serialized).not.toContain("advisorySection");
    expect(serialized).not.toContain("adviserId");
  });
});

describe("getAdvisoryPlacements — floating is a derived state", () => {
  it("takes only an id and a school, never a stored pointer", () => {
    // The signature is the guarantee. It used to take `advisorySectionId` off
    // the session, which is what a flag would look like; it now asks the
    // sections who advises them, so "floating" cannot be recorded anywhere to
    // fall out of step with them.
    expect(getAdvisoryPlacements.length).toBe(1);
    const source = getAdvisoryPlacements.toString();
    expect(source).toContain("adviserId");
    expect(source).not.toContain("advisorySectionId");
  });
});
