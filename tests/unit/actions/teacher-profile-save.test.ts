import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Action-level coverage for `saveTeacherProfile`, one of two writers of
 * `User.advisorySectionId` — the teacher's own self-assignment during profiling.
 * The other is `setTeacherAdvisorySection` (see the sibling test file), where a
 * School Head assigns or changes it on the teacher's behalf.
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
const revalidateSchoolHeadTeachers = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTeacherCaches: (...args: unknown[]) =>
    revalidateTeacherCaches(...(args as [])),
  revalidateSchoolDashboard: (...args: unknown[]) =>
    revalidateSchoolDashboard(...(args as [])),
  revalidateSchoolHeadTeachers: (...args: unknown[]) =>
    revalidateSchoolHeadTeachers(...(args as [])),
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
  // Failure messages are asserted as the *teacher* would see them. Outside
  // production `describeDbFailure` appends the raw error for the developer, so
  // the no-leak assertions below only mean anything in production.
  vi.stubEnv("NODE_ENV", "production");
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

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Assert the save failed and hand back the message the teacher would read. */
function failureMessage(result: { ok: true } | { ok: false; error: string }): string {
  if (result.ok) throw new Error("expected the save to fail, but it succeeded");
  return result.error;
}

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
    // The teachers workspace is busted through its named helper, which covers
    // all four tab routes — one `revalidatePath` on the root would leave the
    // Pending, Inactive and Declined tabs serving stale rows and stale badges.
    // Asserted with the id, not bare: the helper also busts the tenant-scoped
    // `schoolTeachers(schoolId)` tag, so a site passing another school's id
    // would clear the wrong tenant's ARAL tutor list and leave this one stale.
    expect(revalidateSchoolHeadTeachers).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidatePath).toHaveBeenCalledWith(
      SCHOOL_HEAD_ROUTES.schoolGradeLevels
    );
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

  it("saves an ARAL Volunteer who holds neither a grade nor a section", async () => {
    // The whole point of the designation: an ARAL-only volunteer is attached to
    // no classroom at all, so both halves of the teaching assignment are blank
    // and the save still has to go through.
    const result = await saveTeacherProfile(
      buildFormData({
        designation: ARAL_VOLUNTEER_DESIGNATION,
        position: "",
        currentGradeAssignment: "",
        sectionId: "",
        fieldOfSpecialization: "NA",
        yearsInService: "",
      }),
    );
    expect(result).toEqual({ ok: true });

    // Persisted as NULL rather than skipped, so a teacher who moves to the
    // volunteer designation clears the grade they used to hold.
    const upsert = calls.profileUpsert[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(upsert.create.currentGradeAssignment).toBeNull();
    expect(upsert.update.currentGradeAssignment).toBeNull();
    expect(calls.sectionCreateMany).toHaveLength(0);
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

    const error = failureMessage(await saveTeacherProfile(buildFormData()));
    expect(error).not.toContain("adviser");
    expect(error).not.toContain("User_email_key");
    // Unclassifiable, so the honest advice is "retry, and quote this if it sticks".
    expect(error).toContain("DB-UNKNOWN");
    expect(error).toMatch(/try again/i);
  });

  it("never leaks raw database error text to the client", async () => {
    userUpdateError = new Error(
      'prepared statement "s3" already exists at Section.id = deadbeef',
    );

    const error = failureMessage(await saveTeacherProfile(buildFormData()));
    expect(error).not.toContain("prepared statement");
    expect(error).not.toContain("deadbeef");
    expect(error).toContain("DB-UNKNOWN");
  });

  it("says a stale schema will not fix itself rather than telling the teacher to retry", async () => {
    // The failure this replaced: a migration that relaxes a NOT NULL or adds an
    // enum value is authored but never applied, so the same submission is
    // rejected forever. "Please try again" sent the teacher into a loop that
    // could not succeed, and named nothing an administrator could act on.
    userUpdateError = Object.assign(new Error('column "employmentType" does not exist'), {
      code: "P2022",
    });

    const error = failureMessage(await saveTeacherProfile(buildFormData()));
    expect(error).toMatch(/won't help/i);
    expect(error).toContain("DB-SCHEMA");
    expect(error).not.toContain("employmentType");
  });

  it("still prefers the specific section-conflict message over the generic classifier", async () => {
    // Regression guard for ordering: the two branches that know exactly what
    // went wrong must run before the catch-all, or a section race would come
    // back as an unhelpful "the database rejected the change".
    userUpdateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["advisorySectionId"] },
    });

    const error = failureMessage(await saveTeacherProfile(buildFormData()));
    expect(error).toBe("That section already has an adviser.");
    expect(error).not.toContain("DB-");
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
    // The conditional rule fired — not some unrelated rejection. A classroom
    // designation is what makes the grade mandatory.
    expect(result).toEqual({ ok: false, error: "Select a grade level" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
