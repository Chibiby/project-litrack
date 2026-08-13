import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Action-level coverage for `saveTeacherProfile`, the sole writer of
 * `User.advisorySectionId` now that the School Head's manual advisory UI is gone.
 *
 * Only the leaf infrastructure is mocked (Prisma client, session, audit, cache).
 * The real `teacherProfileSchema` and the real `setTeacherAdvisory` helper run,
 * so these tests exercise production logic — the fake transaction client just
 * records the SQL-shaped calls that logic makes.
 */

const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SECTION_ID = "22222222-2222-4222-8222-222222222222";
const GRADE_ID = "grade-g3";

type SectionRow = {
  id: string;
  gradeLevelId: string;
  schoolId: string;
  deletedAt: Date | null;
};

type TxCalls = {
  profileUpsert: unknown[];
  userUpdate: unknown[];
  sectionDeleteMany: unknown[];
  sectionCreateMany: unknown[];
};

let sections: SectionRow[];
let teacherRow: { advisorySectionId: string | null; taughtGrades: { id: string }[] };
let calls: TxCalls;
/**
 * Set to make the advisory `user.update` reject, simulating another teacher
 * claiming the section between validation and commit. Scoped to the update that
 * actually writes the unique `advisorySectionId` column — the names /
 * profileCompleted update has no unique constraint to violate.
 */
let userUpdateError: unknown = null;

function makeTx() {
  return {
    teacherProfile: {
      upsert: vi.fn(async (args: unknown) => {
        calls.profileUpsert.push(args);
        return {};
      }),
    },
    user: {
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.userUpdate.push(args);
        if (userUpdateError && "advisorySectionId" in args.data) throw userUpdateError;
        return {};
      }),
      findUniqueOrThrow: vi.fn(async () => teacherRow),
    },
    teacherSection: {
      deleteMany: vi.fn(async (args: unknown) => {
        calls.sectionDeleteMany.push(args);
        return { count: 0 };
      }),
      createMany: vi.fn(async (args: unknown) => {
        calls.sectionCreateMany.push(args);
        return { count: 1 };
      }),
    },
    section: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; schoolId: string } }) => {
        const ids = args.where.id.in;
        return sections
          .filter(
            (s) => ids.includes(s.id) && s.schoolId === args.where.schoolId && s.deletedAt === null,
          )
          .map((s) => ({ id: s.id, gradeLevelId: s.gradeLevelId }));
      }),
    },
  };
}

const transaction = vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
  cb(makeTx()),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: TEACHER_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  AUDIT_ACTIONS: { TEACHER_PROFILE_SAVE: "TEACHER_PROFILE_SAVE" },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

const revalidateTeacherCaches = vi.fn();
const revalidateSchoolDashboard = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTeacherCaches: (...args: unknown[]) =>
    revalidateTeacherCaches(...(args as [])),
  revalidateSchoolDashboard: (...args: unknown[]) =>
    revalidateSchoolDashboard(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { saveTeacherProfile } = await import("@/lib/actions/teacher");

/**
 * Minimal valid wizard submission. Overrides are merged over the base; an
 * override of `""` OMITS the key from the FormData entirely (matching a field
 * the browser never submits), it does not send an empty value.
 */
function buildFormData(overrides: Record<string, string | string[]> = {}): FormData {
  const base: Record<string, string | string[]> = {
    firstName: "Juan",
    lastName: "Dela Cruz",
    designation: "Teacher",
    position: "TEACHER_III",
    currentGradeAssignment: "G3",
    sectionId: SECTION_ID,
    educationalAttainment: "BACHELORS",
    fieldOfSpecialization: "ENGLISH",
    yearsInService: "4",
    hasReadingTraining: "true",
    "readingTrainings[]": ["ARAL"],
    hasEnglishTraining: "false",
    highestTrainingLevel: "DIVISION",
  };
  const merged = { ...base, ...overrides };
  const fd = new FormData();
  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else if (value !== "") {
      fd.set(key, value);
    }
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  userUpdateError = null;
  sections = [
    { id: SECTION_ID, gradeLevelId: GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null },
    { id: OTHER_SECTION_ID, gradeLevelId: GRADE_ID, schoolId: OTHER_SCHOOL_ID, deletedAt: null },
  ];
  teacherRow = { advisorySectionId: null, taughtGrades: [] };
  calls = {
    profileUpsert: [],
    userUpdate: [],
    sectionDeleteMany: [],
    sectionCreateMany: [],
  };
  requireSchoolUser.mockResolvedValue({ id: TEACHER_ID, schoolId: SCHOOL_ID });
  // The action logs failures with console.error; keep test output pristine.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveTeacherProfile", () => {
  it("assigns the advisory section and dual-writes TeacherSection for a Teacher", async () => {
    const result = await saveTeacherProfile(buildFormData());
    expect(result).toEqual({ ok: true });

    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");

    // Advisory pointer + derived taughtGrades connect
    expect(calls.userUpdate).toHaveLength(2);
    const advisoryUpdate = calls.userUpdate[1] as {
      where: { id: string };
      data: { advisorySectionId: string | null; taughtGrades: unknown };
    };
    expect(advisoryUpdate.where).toEqual({ id: TEACHER_ID });
    expect(advisoryUpdate.data.advisorySectionId).toBe(SECTION_ID);
    expect(advisoryUpdate.data.taughtGrades).toEqual({ connect: [{ id: GRADE_ID }] });

    // Legacy m2m mirror: stale rows dropped, advisory row inserted
    expect(calls.sectionDeleteMany[0]).toEqual({
      where: { teacherId: TEACHER_ID, sectionId: { not: SECTION_ID } },
    });
    expect(calls.sectionCreateMany[0]).toEqual({
      data: [{ teacherId: TEACHER_ID, sectionId: SECTION_ID }],
      skipDuplicates: true,
    });

    // Profile row carries the parsed assignment and no dropped mostSubjectHandled
    const upsert = calls.profileUpsert[0] as {
      where: { userId: string };
      create: Record<string, unknown>;
    };
    expect(upsert.where).toEqual({ userId: TEACHER_ID });
    expect(upsert.create.currentGradeAssignment).toBe("G3");
    expect(upsert.create.yearsInService).toBe(4);
    expect(upsert.create).not.toHaveProperty("mostSubjectHandled");
    // sectionId lives on User, never on TeacherProfile
    expect(upsert.create).not.toHaveProperty("sectionId");

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TEACHER_PROFILE_SAVE",
        resourceId: TEACHER_ID,
        metadata: expect.objectContaining({ sectionId: SECTION_ID, designation: "Teacher" }),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/school-head/teachers");
    expect(revalidatePath).toHaveBeenCalledWith("/school-head/grade-levels");
    // Grade/section self-assignment changes the sidebar shell too, so the
    // combined helper (dashboard + shell) must be the one called.
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ID);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
  });

  it("clears the advisory section for an ARAL Volunteer who submits none", async () => {
    // Volunteer previously advised a section; submitting without one must release it.
    teacherRow = { advisorySectionId: SECTION_ID, taughtGrades: [{ id: GRADE_ID }] };

    const result = await saveTeacherProfile(
      buildFormData({
        designation: ARAL_VOLUNTEER_DESIGNATION,
        position: "",
        sectionId: "",
        fieldOfSpecialization: "NA",
        yearsInService: "",
      }),
    );
    expect(result).toEqual({ ok: true });

    const advisoryUpdate = calls.userUpdate[1] as {
      data: { advisorySectionId: string | null; taughtGrades: unknown };
    };
    expect(advisoryUpdate.data.advisorySectionId).toBeNull();
    expect(advisoryUpdate.data.taughtGrades).toEqual({ disconnect: [{ id: GRADE_ID }] });

    // No section requested → no m2m row created, and all stale rows dropped
    expect(calls.sectionCreateMany).toHaveLength(0);
    expect(calls.sectionDeleteMany[0]).toEqual({ where: { teacherId: TEACHER_ID } });

    // N/A years in service persists as NULL, not 0
    const upsert = calls.profileUpsert[0] as { create: Record<string, unknown> };
    expect(upsert.create.yearsInService).toBeNull();
    expect(upsert.create.position).toBeNull();

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          sectionId: null,
          designation: ARAL_VOLUNTEER_DESIGNATION,
        }),
      }),
    );
  });

  it("returns the shared section-taken message on a P2002 race instead of throwing", async () => {
    userUpdateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["advisorySectionId"] },
    });

    await expect(saveTeacherProfile(buildFormData())).resolves.toEqual({
      ok: false,
      error: "That section already has an adviser.",
    });
  });

  it("does not label an unrelated unique violation as a section conflict", async () => {
    // A P2002 on some other unique column must not tell the teacher their
    // section was taken — and must not echo the raw database text either.
    userUpdateError = Object.assign(new Error("Unique constraint failed on `User_email_key`"), {
      code: "P2002",
      meta: { target: ["email"] },
    });

    const result = await saveTeacherProfile(buildFormData());
    expect(result).toEqual({ ok: false, error: "Failed to save profile. Please try again." });
  });

  it("never leaks raw database error text to the client", async () => {
    userUpdateError = new Error(
      'prepared statement "s3" already exists at Section.id = deadbeef',
    );

    const result = await saveTeacherProfile(buildFormData());
    expect(result).toEqual({ ok: false, error: "Failed to save profile. Please try again." });
    expect(JSON.stringify(result)).not.toContain("prepared statement");
  });

  it("rejects a section from another school without leaking its existence", async () => {
    const result = await saveTeacherProfile(buildFormData({ sectionId: OTHER_SECTION_ID }));
    expect(result).toEqual({ ok: false, error: "Invalid section selected." });
    // Nothing about the other tenant's section is echoed back.
    expect(JSON.stringify(result)).not.toContain(OTHER_SECTION_ID);
    // Validation of the section happens before any advisory write, so only the
    // names / profileCompleted update ran inside the (rolled back) transaction.
    expect(calls.userUpdate).toHaveLength(1);
  });

  it("rejects a soft-deleted section the same way", async () => {
    sections = sections.map((s) =>
      s.id === SECTION_ID ? { ...s, deletedAt: new Date() } : s,
    );

    await expect(saveTeacherProfile(buildFormData())).resolves.toEqual({
      ok: false,
      error: "Invalid section selected.",
    });
  });

  it("does not raise a false section-taken error when re-saving the same section", async () => {
    // Self-exclusion: the teacher already advises SECTION_ID, so the unique
    // advisory column is never rewritten and P2002 cannot fire.
    teacherRow = { advisorySectionId: SECTION_ID, taughtGrades: [{ id: GRADE_ID }] };
    userUpdateError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

    const result = await saveTeacherProfile(buildFormData());
    expect(result).toEqual({ ok: true });

    // Only the names/profileCompleted update ran — no advisory rewrite.
    expect(calls.userUpdate).toHaveLength(1);
    expect(calls.sectionCreateMany[0]).toEqual({
      data: [{ teacherId: TEACHER_ID, sectionId: SECTION_ID }],
      skipDuplicates: true,
    });
  });

  it("rejects a submission missing the now-required section before touching the database", async () => {
    const result = await saveTeacherProfile(buildFormData({ sectionId: "" }));
    expect(result).toEqual({ ok: false, error: "Select a section" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a submission missing the now-required grade assignment", async () => {
    const result = await saveTeacherProfile(buildFormData({ currentGradeAssignment: "" }));
    expect(result.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
});
