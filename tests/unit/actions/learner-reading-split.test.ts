import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Grade 1-3 split the old combined "Developing or Transitioning"
 * (INSTRUCTIONAL_DEVELOPING) into DEVELOPING and TRANSITIONING. A Grade 1-3
 * learner still holding the old value must re-pick on their next save — even
 * though `updateLearner` otherwise lets an unchanged out-of-policy value ride
 * along — while Grade 4+ keep INSTRUCTIONAL_DEVELOPING ("Instructional").
 */

const SCHOOL_ID = "school-1";
const TEACHER_ID = "teacher-1";
const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const LEGACY = "Choose Developing or Transitioning — the old combined level was split";

type StoredLearner = {
  id: string;
  schoolId: string;
  teacherId: string;
  aralTeacherId: null;
  gradeLevelId: string;
  sectionId: string | null;
  englishReadingProfile: string | null;
  filipinoReadingProfile: string;
  governmentBenefits: string[];
  gradeLevel: { type: string };
};

let stored: StoredLearner;
let advisoryGradeType = "G1";
const learnerUpdate = vi.fn();
const learnerCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findFirst: async () => stored,
      findMany: async () => [],
    },
    schoolYear: { findFirst: async () => null },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        learner: {
          update: (...a: unknown[]) => learnerUpdate(...a),
          create: async (...a: unknown[]) => {
            learnerCreate(...a);
            return { id: LEARNER_ID, gradeLevelId: "grade-1", sectionId: "section-1" };
          },
        },
        enrollment: { create: vi.fn() },
      }),
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    profileCompleted: true,
  }),
}));
vi.mock("@/lib/teachers/advisory", () => ({
  getAdvisoryPlacements: async () => [
    { sectionId: "section-1", gradeLevelId: "grade-1", gradeType: advisoryGradeType },
  ],
  resolveAdvisoryTarget: (placements: unknown[]) => ({ ok: true, placement: placements[0] }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  writeAuditMany: vi.fn(),
  AUDIT_ACTIONS: { LEARNER_UPDATE: "LEARNER_UPDATE", LEARNER_CREATE: "LEARNER_CREATE" },
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notifyAralAssigned: vi.fn() }));

const { updateLearner, createLearner } = await import("@/lib/actions/learner");

function learnerIn(gradeType: string, profiles: { en: string | null; fil: string }): StoredLearner {
  return {
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    gradeLevelId: "grade-1",
    sectionId: null,
    englishReadingProfile: profiles.en,
    filipinoReadingProfile: profiles.fil,
    governmentBenefits: [],
    gradeLevel: { type: gradeType },
  };
}

function form(profiles: { en?: string; fil: string }) {
  const fd = new FormData();
  fd.set("id", LEARNER_ID);
  fd.set("firstName", "Ana");
  fd.set("lastName", "Santos");
  fd.set("age", "8");
  fd.set("gender", "FEMALE");
  fd.set("nutritionalStatus", "NORMAL");
  fd.set("parentEducation", "SECONDARY_GRADUATE");
  if (profiles.en) fd.set("englishReadingProfile", profiles.en);
  fd.set("filipinoReadingProfile", profiles.fil);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function createForm(profiles: { en?: string; fil: string }) {
  const fd = form(profiles);
  fd.delete("id");
  fd.set("gradeLevelId", "grade-1"); // must match the advisory placement's grade
  return fd;
}

describe("createLearner — Grade 1-3 legacy INSTRUCTIONAL_DEVELOPING is rejected on new saves", () => {
  it.each(["G1", "G2"])("rejects a legacy Filipino level for a %s advisory and creates nothing", async (g) => {
    advisoryGradeType = g;

    const res = await createLearner(createForm({ fil: "INSTRUCTIONAL_DEVELOPING" }));

    expect(res).toEqual({ ok: false, error: LEGACY });
    expect(learnerCreate).not.toHaveBeenCalled();
  });

  it("rejects a legacy Filipino level for a G3 advisory", async () => {
    advisoryGradeType = "G3";

    const res = await createLearner(createForm({ en: "DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" }));

    expect(res).toEqual({ ok: false, error: LEGACY });
    expect(learnerCreate).not.toHaveBeenCalled();
  });

  it("rejects a legacy English level for a G3 advisory", async () => {
    advisoryGradeType = "G3";

    const res = await createLearner(createForm({ en: "INSTRUCTIONAL_DEVELOPING", fil: "DEVELOPING" }));

    expect(res).toEqual({ ok: false, error: LEGACY });
    expect(learnerCreate).not.toHaveBeenCalled();
  });

  it("creates the learner when a G3 advisory picks Developing / Transitioning", async () => {
    advisoryGradeType = "G3";

    const res = await createLearner(createForm({ en: "DEVELOPING", fil: "TRANSITIONING" }));

    expect(res).toMatchObject({ ok: true });
    expect(learnerCreate).toHaveBeenCalledTimes(1);
  });

  it("does NOT reject INSTRUCTIONAL_DEVELOPING for a G4 advisory (it is 'Instructional' there)", async () => {
    advisoryGradeType = "G4";

    const res = await createLearner(
      createForm({ en: "INSTRUCTIONAL_DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" })
    );

    expect(res).toMatchObject({ ok: true });
    expect(learnerCreate).toHaveBeenCalledTimes(1);
  });
});

describe("updateLearner — Grade 1-3 Developing / Transitioning split", () => {
  it("rejects an UNCHANGED legacy Filipino level on a Grade 2 learner and writes nothing", async () => {
    stored = learnerIn("G2", { en: null, fil: "INSTRUCTIONAL_DEVELOPING" });

    const res = await updateLearner(form({ fil: "INSTRUCTIONAL_DEVELOPING" }));

    expect(res).toEqual({ ok: false, error: LEGACY });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("rejects an UNCHANGED legacy English level on a Grade 3 learner", async () => {
    stored = learnerIn("G3", { en: "INSTRUCTIONAL_DEVELOPING", fil: "DEVELOPING" });

    const res = await updateLearner(form({ en: "INSTRUCTIONAL_DEVELOPING", fil: "DEVELOPING" }));

    expect(res).toEqual({ ok: false, error: LEGACY });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("saves once the Grade 3 teacher re-picks Developing and Transitioning", async () => {
    stored = learnerIn("G3", { en: "INSTRUCTIONAL_DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" });

    const res = await updateLearner(form({ en: "DEVELOPING", fil: "TRANSITIONING" }));

    expect(res).toEqual({ ok: true });
    expect(learnerUpdate).toHaveBeenCalledTimes(1);
  });

  it("Grade 4 keeps INSTRUCTIONAL_DEVELOPING as a valid level", async () => {
    stored = learnerIn("G4", { en: "INSTRUCTIONAL_DEVELOPING", fil: "FRUSTRATION_HIGH_EMERGENT" });

    const res = await updateLearner(
      form({ en: "INSTRUCTIONAL_DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" })
    );

    expect(res).toEqual({ ok: true });
    expect(learnerUpdate).toHaveBeenCalledTimes(1);
  });

  it("Grade 4 rejects a newly chosen DEVELOPING or TRANSITIONING", async () => {
    stored = learnerIn("G4", { en: "INSTRUCTIONAL_DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" });

    expect(await updateLearner(form({ en: "DEVELOPING", fil: "INSTRUCTIONAL_DEVELOPING" }))).toEqual({
      ok: false,
      error: "Invalid English reading level for this grade",
    });
    expect(await updateLearner(form({ en: "INSTRUCTIONAL_DEVELOPING", fil: "TRANSITIONING" }))).toEqual({
      ok: false,
      error: "Invalid Filipino reading level for this grade",
    });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });
});
