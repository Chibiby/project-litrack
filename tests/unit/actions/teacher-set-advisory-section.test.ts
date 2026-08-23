import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Action-level coverage for `setTeacherAdvisorySection` — the School Head's
 * advisory assign / change / clear control in the Teachers tab.
 *
 * The behaviour worth pinning here is the conflict policy. `User.advisorySectionId`
 * is unique, so assigning an occupied section is refused rather than granted, and
 * the refusal names the sitting adviser so the School Head knows whose advisory to
 * clear first. A silent steal would strip that teacher of the only roster they can
 * reach without telling anyone, so "who holds it" is part of the contract, not a
 * nicety — hence the assertions on the message text.
 *
 * Only leaf infrastructure is mocked (Prisma client, session, audit, cache). The
 * real `setTeacherAdvisory` helper runs, so the dual-write to the legacy
 * `TeacherSection` / `taughtGrades` mirrors is genuinely exercised.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";
const TEACHER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TEACHER_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const TAKEN_SECTION_ID = "22222222-2222-4222-8222-222222222222";
const GRADE_ID = "grade-g3";

type SectionRow = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeType: string;
  schoolId: string;
  deletedAt: Date | null;
  adviser: { id: string; fullName: string } | null;
};

type TxCalls = {
  userUpdate: unknown[];
  sectionDeleteMany: unknown[];
  sectionCreateMany: unknown[];
};

let sections: SectionRow[];
/** The row `prisma.user.findFirst` resolves for the targeted teacher, or null. */
let teacherLookup: { id: string; advisorySectionId: string | null } | null;
/** What `findUniqueOrThrow` reports inside the transaction. */
let teacherRow: { advisorySectionId: string | null; taughtGrades: { id: string }[] };
let calls: TxCalls;
/** Set to make the advisory `user.update` reject, simulating a mid-flight race. */
let userUpdateError: unknown = null;

function makeTx() {
  return {
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
      findMany: vi.fn(
        async (args: { where: { id: { in: string[] }; schoolId: string } }) => {
          const ids = args.where.id.in;
          return sections
            .filter(
              (s) =>
                ids.includes(s.id) &&
                s.schoolId === args.where.schoolId &&
                s.deletedAt === null
            )
            .map((s) => ({ id: s.id, gradeLevelId: s.gradeLevelId }));
        }
      ),
    },
  };
}

const transaction = vi.fn(
  async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx())
);

/**
 * Top-level (non-transaction) reads the action makes before it commits: the
 * teacher lookup, and the section lookup whose only job is to name the adviser.
 * Both are tenant-scoped, so the fakes honour `where.schoolId` rather than
 * ignoring it — a fake that returned rows regardless would hide exactly the
 * cross-tenant bug these tests are here to catch.
 */
const userFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string } }) =>
    teacherLookup && teacherLookup.id === args.where.id && args.where.schoolId === SCHOOL_ID
      ? teacherLookup
      : null
);

const sectionFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string } }) => {
    const found = sections.find(
      (s) =>
        s.id === args.where.id &&
        s.schoolId === args.where.schoolId &&
        s.deletedAt === null
    );
    if (!found) return null;
    return {
      name: found.name,
      gradeLevel: { type: found.gradeType },
      adviser: found.adviser,
    };
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    user: {
      findFirst: (...args: unknown[]) => userFindFirst(...(args as [never])),
    },
    section: {
      findFirst: (...args: unknown[]) => sectionFindFirst(...(args as [never])),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  AUDIT_ACTIONS: { TEACHER_SET_ADVISORY_SECTION: "TEACHER_SET_ADVISORY_SECTION" },
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
const { setTeacherAdvisorySection } = await import("@/lib/actions/teacher");

function buildFormData(teacherId: string, sectionId: string): FormData {
  const fd = new FormData();
  fd.set("teacherId", teacherId);
  // Always set, including as "" — that is how the client clears an advisory.
  fd.set("sectionId", sectionId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  userUpdateError = null;
  sections = [
    {
      id: SECTION_ID,
      name: "Sampaguita",
      gradeLevelId: GRADE_ID,
      gradeType: "G3",
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviser: null,
    },
    {
      id: TAKEN_SECTION_ID,
      name: "Rosal",
      gradeLevelId: GRADE_ID,
      gradeType: "G3",
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviser: { id: OTHER_TEACHER_ID, fullName: "Marivic Santos" },
    },
  ];
  teacherLookup = { id: TEACHER_ID, advisorySectionId: null };
  teacherRow = { advisorySectionId: null, taughtGrades: [] };
  calls = { userUpdate: [], sectionDeleteMany: [], sectionCreateMany: [] };
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  // The action logs failures with console.error; keep test output pristine.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setTeacherAdvisorySection", () => {
  it("assigns a free section and dual-writes the legacy mirrors", async () => {
    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({ ok: true });

    // Only a School Head may reach this action; Super Admin passes role checks
    // by default, which is why the guard is asserted rather than assumed.
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");

    const advisoryUpdate = calls.userUpdate[0] as {
      where: { id: string };
      data: { advisorySectionId: string | null; taughtGrades: unknown };
    };
    expect(advisoryUpdate.where).toEqual({ id: TEACHER_ID });
    expect(advisoryUpdate.data.advisorySectionId).toBe(SECTION_ID);
    expect(advisoryUpdate.data.taughtGrades).toEqual({ connect: [{ id: GRADE_ID }] });

    expect(calls.sectionCreateMany[0]).toEqual({
      data: [{ teacherId: TEACHER_ID, sectionId: SECTION_ID }],
      skipDuplicates: true,
    });

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        action: "TEACHER_SET_ADVISORY_SECTION",
        resource: "User",
        resourceId: TEACHER_ID,
        metadata: expect.objectContaining({
          teacherId: TEACHER_ID,
          previousSectionId: null,
          sectionId: SECTION_ID,
        }),
      })
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
    // The teacher's own surfaces show this advisory too.
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/settings/profile");
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ID);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
  });

  it("clears an advisory when the School Head picks Unassigned", async () => {
    teacherLookup = { id: TEACHER_ID, advisorySectionId: SECTION_ID };
    teacherRow = { advisorySectionId: SECTION_ID, taughtGrades: [{ id: GRADE_ID }] };

    const result = await setTeacherAdvisorySection(buildFormData(TEACHER_ID, ""));
    expect(result).toEqual({ ok: true });

    const advisoryUpdate = calls.userUpdate[0] as {
      data: { advisorySectionId: string | null; taughtGrades: unknown };
    };
    expect(advisoryUpdate.data.advisorySectionId).toBeNull();
    expect(advisoryUpdate.data.taughtGrades).toEqual({
      disconnect: [{ id: GRADE_ID }],
    });

    // Releasing an advisory needs no section lookup — there is no adviser to name.
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expect(calls.sectionCreateMany).toHaveLength(0);
    expect(calls.sectionDeleteMany[0]).toEqual({ where: { teacherId: TEACHER_ID } });

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          previousSectionId: SECTION_ID,
          sectionId: null,
        }),
      })
    );
  });

  it("refuses an occupied section and names the sitting adviser", async () => {
    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, TAKEN_SECTION_ID)
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Grade 3 · Rosal is advised by Marivic Santos. Set them to Unassigned first, then assign this section here.",
    });

    // Refused before the transaction: the sitting adviser keeps their section.
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to a generic noun when the sitting adviser has no name", async () => {
    sections = sections.map((s) =>
      s.id === TAKEN_SECTION_ID
        ? { ...s, adviser: { id: OTHER_TEACHER_ID, fullName: "" } }
        : s
    );

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, TAKEN_SECTION_ID)
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Grade 3 · Rosal is advised by another teacher. Set them to Unassigned first, then assign this section here.",
    });
  });

  it("is a no-op when the teacher already advises the requested section", async () => {
    teacherLookup = { id: TEACHER_ID, advisorySectionId: SECTION_ID };

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({ ok: true });

    // No write, and crucially no audit row claiming a change that did not happen.
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("does not treat the teacher's own section as occupied", async () => {
    // The teacher holds TAKEN_SECTION_ID; re-submitting a different field must not
    // trip the conflict branch against themselves.
    teacherLookup = { id: TEACHER_ID, advisorySectionId: null };
    sections = sections.map((s) =>
      s.id === TAKEN_SECTION_ID
        ? { ...s, adviser: { id: TEACHER_ID, fullName: "Self" } }
        : s
    );

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, TAKEN_SECTION_ID)
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a teacher from another school without leaking their existence", async () => {
    // The lookup is scoped to the caller's school, so a real teacher elsewhere
    // resolves to nothing — same answer as an id that does not exist at all.
    teacherLookup = null;

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({ ok: false, error: "Teacher not found" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a section from another school without leaking its existence", async () => {
    sections = sections.map((s) =>
      s.id === SECTION_ID ? { ...s, schoolId: "school-2" } : s
    );

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({ ok: false, error: "Section not found" });
    expect(JSON.stringify(result)).not.toContain("school-2");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted section the same way", async () => {
    sections = sections.map((s) =>
      s.id === SECTION_ID ? { ...s, deletedAt: new Date() } : s
    );

    await expect(
      setTeacherAdvisorySection(buildFormData(TEACHER_ID, SECTION_ID))
    ).resolves.toEqual({ ok: false, error: "Section not found" });
  });

  it("returns the shared section-taken message when the section is claimed mid-flight", async () => {
    // The pre-check saw a free section, so there is no adviser name to offer —
    // the generic message is the honest answer for a race.
    userUpdateError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["advisorySectionId"] },
    });

    await expect(
      setTeacherAdvisorySection(buildFormData(TEACHER_ID, SECTION_ID))
    ).resolves.toEqual({ ok: false, error: "That section already has an adviser." });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("does not label an unrelated unique violation as a section conflict", async () => {
    userUpdateError = Object.assign(
      new Error("Unique constraint failed on `User_email_key`"),
      { code: "P2002", meta: { target: ["email"] } }
    );

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({
      ok: false,
      error: "Failed to update the advisory. Please try again.",
    });
  });

  it("never leaks raw database error text to the client", async () => {
    userUpdateError = new Error(
      'prepared statement "s3" already exists at Section.id = deadbeef'
    );

    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({
      ok: false,
      error: "Failed to update the advisory. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("prepared statement");
  });

  it("rejects a malformed teacher id before touching the database", async () => {
    const result = await setTeacherAdvisorySection(
      buildFormData("not-a-uuid", SECTION_ID)
    );
    expect(result).toEqual({ ok: false, error: "Invalid teacher" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed section id before touching the database", async () => {
    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, "42")
    );
    expect(result).toEqual({ ok: false, error: "Invalid section" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
