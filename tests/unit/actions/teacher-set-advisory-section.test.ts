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
import { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";

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
  learnerUpdateMany: unknown[];
  enrollmentUpdateMany: unknown[];
};

let sections: SectionRow[];
/** The row `prisma.user.findFirst` resolves for the targeted teacher, or null. */
let teacherLookup: { id: string; advisorySections: { id: string }[] } | null;
/** What `findUniqueOrThrow` reports inside the transaction. */
let teacherRow: { advisorySectionId: string | null; taughtGrades: { id: string }[] };
/** The teacher's advisory profile (designation and mode) in the transaction. */
let teacherProfile: { designation: string; advisoryMode: string } | null = null;
let calls: TxCalls;
/** Set to make the advisory `user.update` reject, simulating a mid-flight race. */
let userUpdateError: unknown = null;

/** Live sections this teacher advises, straight off the fixture. */
function advisoriesOf(teacherId: string): SectionRow[] {
  return sections.filter(
    (s) => s.adviser?.id === teacherId && s.deletedAt === null
  );
}

function makeTx() {
  return {
    teacherProfile: {
      findFirst: vi.fn(async () => teacherProfile ?? { designation: "Teacher", advisoryMode: "MULTI_GRADE" }),
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
    learner: {
      updateMany: vi.fn(async (args: unknown) => {
        calls.learnerUpdateMany.push(args);
        return { count: 0 };
      }),
    },
    enrollment: {
      updateMany: vi.fn(async (args: unknown) => {
        calls.enrollmentUpdateMany.push(args);
        return { count: 0 };
      }),
    },
    section: {
      findMany: vi.fn(
        async (args: {
          where: {
            id?: { in: string[] };
            adviserId?: string;
            schoolId: string;
            deletedAt: null;
          };
        }) => {
          const rows = sections.filter((s) => {
            if (s.schoolId !== args.where.schoolId) return false;
            if (s.deletedAt !== null) return false;
            if (args.where.id && !args.where.id.in.includes(s.id)) return false;
            if (args.where.adviserId && s.adviser?.id !== args.where.adviserId) {
              return false;
            }
            return true;
          });
          return rows.map((s) => ({
            id: s.id,
            name: s.name,
            gradeLevelId: s.gradeLevelId,
          }));
        }
      ),
      // Really moves the pointer, so the "read the set back" step inside
      // `setTeacherAdvisory` sees what the write actually did. A fake that
      // no-op'd here would let the cap and the dual-write assertions pass
      // against a set that never changed.
      updateMany: vi.fn(
        async (args: {
          where: { id?: string; adviserId?: string | null; schoolId: string };
          data: { adviserId: string | null };
        }) => {
          let count = 0;
          for (const s of sections) {
            if (s.schoolId !== args.where.schoolId) continue;
            if (args.where.id && s.id !== args.where.id) continue;
            if (
              args.where.adviserId !== undefined &&
              (args.where.adviserId === null
                ? s.adviser !== null
                : s.adviser?.id !== args.where.adviserId)
            ) {
              continue;
            }
            s.adviser = args.data.adviserId
              ? { id: args.data.adviserId, fullName: "Marivic Cruz" }
              : null;
            count += 1;
          }
          return { count };
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
  teacherProfile = null;
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
  teacherLookup = { id: TEACHER_ID, advisorySections: [] };
  teacherRow = { advisorySectionId: null, taughtGrades: [] };
  calls = {
    userUpdate: [],
    sectionDeleteMany: [],
    sectionCreateMany: [],
    learnerUpdateMany: [],
    enrollmentUpdateMany: [],
  };
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
          previousSectionIds: [],
          op: "add",
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
    teacherLookup = { id: TEACHER_ID, advisorySections: [{ id: SECTION_ID }] };
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
          previousSectionIds: [SECTION_ID],
          op: "clear",
          sectionId: null,
        }),
      })
    );
  });

  it("gives the new adviser the learners the section was left holding", async () => {
    // A removed teacher's section keeps its learners with no adviser. Whoever
    // takes the section next takes them too — only the adviser-less ones, so a
    // learner another teacher still advises is never pulled across.
    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, SECTION_ID)
    );
    expect(result).toEqual({ ok: true });

    expect(calls.learnerUpdateMany).toEqual([
      {
        where: {
          sectionId: SECTION_ID,
          schoolId: SCHOOL_ID,
          teacherId: null,
          deletedAt: null,
          archivedAt: null,
        },
        data: { teacherId: TEACHER_ID },
      },
    ]);
    // The active enrolment follows, so it keeps agreeing with the learner row.
    expect(calls.enrollmentUpdateMany).toEqual([
      {
        where: {
          sectionId: SECTION_ID,
          schoolId: SCHOOL_ID,
          teacherId: null,
          status: "ACTIVE",
          learner: { deletedAt: null, archivedAt: null },
        },
        data: { teacherId: TEACHER_ID },
      },
    ]);
  });

  it("leaves learners alone when an advisory is removed or cleared", async () => {
    teacherLookup = { id: TEACHER_ID, advisorySections: [{ id: SECTION_ID }] };
    teacherRow = { advisorySectionId: SECTION_ID, taughtGrades: [{ id: GRADE_ID }] };

    await setTeacherAdvisorySection(buildFormData(TEACHER_ID, ""));

    expect(calls.learnerUpdateMany).toEqual([]);
    expect(calls.enrollmentUpdateMany).toEqual([]);
  });

  it("refuses an occupied section and names the sitting adviser", async () => {
    const result = await setTeacherAdvisorySection(
      buildFormData(TEACHER_ID, TAKEN_SECTION_ID)
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Grade 3 · Rosal is advised by Marivic Santos. Remove it from them first, then add it here.",
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
        "Grade 3 · Rosal is advised by another teacher. Remove it from them first, then add it here.",
    });
  });

  it("is a no-op when the teacher already advises the requested section", async () => {
    teacherLookup = { id: TEACHER_ID, advisorySections: [{ id: SECTION_ID }] };

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
    teacherLookup = { id: TEACHER_ID, advisorySections: [] };
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

/**
 * §4 of the ten concerns: a teacher may advise up to three sections.
 *
 * The cap is enforced INSIDE the transaction, against the rows as they are
 * there, and that placement is the point. A check in the action before the
 * transaction opens would let two School Heads on two tabs each read "holds
 * three... no, two" and each add one, landing a fourth between them. The action
 * layer is where the NUMBER lives — moving it must not need a migration — but
 * the transaction is where it is applied.
 */
describe("setTeacherAdvisorySection — the cap of three", () => {
  const FOURTH_SECTION_ID = "55555555-5555-4555-8555-555555555555";

  /** Give the teacher `count` live advisories, and offer one more free section. */
  /** Real uuids: the action Zod-validates the posted id before anything else. */
  const HELD_IDS = [
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];

  function holding(count: number) {
    sections = [];
    for (let i = 0; i < count; i += 1) {
      sections.push({
        id: HELD_IDS[i],
        name: `Section ${i}`,
        gradeLevelId: GRADE_ID,
        gradeType: "G3",
        schoolId: SCHOOL_ID,
        deletedAt: null,
        adviser: { id: TEACHER_ID, fullName: "Marivic Cruz" },
      });
    }
    sections.push({
      id: FOURTH_SECTION_ID,
      name: "One More",
      gradeLevelId: GRADE_ID,
      gradeType: "G3",
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviser: null,
    });
    teacherLookup = {
      id: TEACHER_ID,
      advisorySections: sections
        .filter((s) => s.adviser?.id === TEACHER_ID)
        .map((s) => ({ id: s.id })),
    };
  }

  function add(sectionId: string) {
    const fd = new FormData();
    fd.set("teacherId", TEACHER_ID);
    fd.set("sectionId", sectionId);
    fd.set("op", "add");
    return setTeacherAdvisorySection(fd);
  }

  it("accepts a third", async () => {
    holding(2);

    expect(await add(FOURTH_SECTION_ID)).toEqual({ ok: true });
    expect(
      sections.find((s) => s.id === FOURTH_SECTION_ID)?.adviser?.id
    ).toBe(TEACHER_ID);
  });

  it("refuses a fourth", async () => {
    holding(3);

    const result = await add(FOURTH_SECTION_ID);

    expect(result.ok).toBe(false);
    // The section is untouched: a refused add must not half-apply.
    expect(sections.find((s) => s.id === FOURTH_SECTION_ID)?.adviser).toBeNull();
  });

  it("names the sections they already hold, so the head knows what to remove", async () => {
    holding(3);

    const result = await add(FOURTH_SECTION_ID);

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("Section 0");
    expect(result.error).toContain("Section 1");
    expect(result.error).toContain("Section 2");
    expect(result.error).toContain(String(MAX_ADVISORY_SECTIONS));
  });

  it("does not count an archived section against the cap", async () => {
    holding(3);
    // Archiving a section frees its adviser (§7 relies on exactly this), so a
    // teacher holding three of which one is archived may still take a third
    // live one.
    sections.find((s) => s.id === HELD_IDS[0])!.deletedAt = new Date(2026, 0, 1);

    expect(await add(FOURTH_SECTION_ID)).toEqual({ ok: true });
  });

  it("is a no-op, not a refusal, when they already hold the section", async () => {
    holding(3);

    const fd = new FormData();
    fd.set("teacherId", TEACHER_ID);
    fd.set("sectionId", HELD_IDS[1]);
    fd.set("op", "add");

    // Re-adding one of the three must not read as "you are at the limit".
    expect(await setTeacherAdvisorySection(fd)).toEqual({ ok: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("removes one, scoped to this teacher", async () => {
    holding(3);

    const fd = new FormData();
    fd.set("teacherId", TEACHER_ID);
    fd.set("sectionId", HELD_IDS[1]);
    fd.set("op", "remove");

    expect(await setTeacherAdvisorySection(fd)).toEqual({ ok: true });
    expect(sections.find((s) => s.id === HELD_IDS[1])?.adviser).toBeNull();
    // The other two are untouched.
    expect(sections.find((s) => s.id === HELD_IDS[0])?.adviser?.id).toBe(TEACHER_ID);
    expect(sections.find((s) => s.id === HELD_IDS[2])?.adviser?.id).toBe(TEACHER_ID);
  });

  it("frees room for another once one is removed", async () => {
    holding(3);

    const remove = new FormData();
    remove.set("teacherId", TEACHER_ID);
    remove.set("sectionId", HELD_IDS[1]);
    remove.set("op", "remove");
    await setTeacherAdvisorySection(remove);
    teacherLookup = {
      id: TEACHER_ID,
      advisorySections: sections
        .filter((s) => s.adviser?.id === TEACHER_ID)
        .map((s) => ({ id: s.id })),
    };

    expect(await add(FOURTH_SECTION_ID)).toEqual({ ok: true });
  });
});

/**
 * §3 of the ten concerns: advisory caps per mode. The cap is read from the
 * teacher's profile inside the transaction, not from a global constant. A
 * teacher set to DEFAULT may advise one; MULTI_GRADE advises up to three;
 * FLOATING and volunteers advise zero.
 */
describe("setTeacherAdvisorySection — caps per advisory mode", () => {
  const FOURTH_SECTION_ID = "55555555-5555-4555-8555-555555555555";
  const HELD_IDS = [
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];

  function holding(count: number) {
    sections = [];
    for (let i = 0; i < count; i += 1) {
      sections.push({
        id: HELD_IDS[i],
        name: `Section ${i}`,
        gradeLevelId: GRADE_ID,
        gradeType: "G3",
        schoolId: SCHOOL_ID,
        deletedAt: null,
        adviser: { id: TEACHER_ID, fullName: "Marivic Cruz" },
      });
    }
    sections.push({
      id: FOURTH_SECTION_ID,
      name: "One More",
      gradeLevelId: GRADE_ID,
      gradeType: "G3",
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviser: null,
    });
    teacherLookup = {
      id: TEACHER_ID,
      advisorySections: sections
        .filter((s) => s.adviser?.id === TEACHER_ID)
        .map((s) => ({ id: s.id })),
    };
  }

  function add(sectionId: string) {
    const fd = new FormData();
    fd.set("teacherId", TEACHER_ID);
    fd.set("sectionId", sectionId);
    fd.set("op", "add");
    return setTeacherAdvisorySection(fd);
  }

  it("DEFAULT teacher holding one section refuses a second", async () => {
    holding(1);
    teacherProfile = { designation: "Teacher", advisoryMode: "DEFAULT" };

    const result = await add(FOURTH_SECTION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/one section/i);
    }
    // Section is untouched.
    expect(sections.find((s) => s.id === FOURTH_SECTION_ID)?.adviser).toBeNull();
    expect(transaction).toHaveBeenCalled();
  });

  it("MULTI_GRADE teacher holding two accepts a third", async () => {
    holding(2);
    teacherProfile = { designation: "Teacher", advisoryMode: "MULTI_GRADE" };

    const result = await add(FOURTH_SECTION_ID);

    expect(result.ok).toBe(true);
    expect(sections.find((s) => s.id === FOURTH_SECTION_ID)?.adviser?.id).toBe(TEACHER_ID);
  });

  it("MULTI_GRADE teacher holding three refuses a fourth", async () => {
    holding(3);
    teacherProfile = { designation: "Teacher", advisoryMode: "MULTI_GRADE" };

    const result = await add(FOURTH_SECTION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/up to 3/i);
    }
    // Section is untouched.
    expect(sections.find((s) => s.id === FOURTH_SECTION_ID)?.adviser).toBeNull();
  });

  it("FLOATING teacher refuses to advise any section", async () => {
    sections = [
      {
        id: SECTION_ID,
        name: "Free Section",
        gradeLevelId: GRADE_ID,
        gradeType: "G3",
        schoolId: SCHOOL_ID,
        deletedAt: null,
        adviser: null,
      },
    ];
    teacherLookup = { id: TEACHER_ID, advisorySections: [] };
    teacherProfile = { designation: "Teacher", advisoryMode: "FLOATING" };

    const result = await add(SECTION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Floating teachers/i);
    }
    expect(transaction).toHaveBeenCalled();
  });

  it("Volunteer refuses to advise any section", async () => {
    sections = [
      {
        id: SECTION_ID,
        name: "Free Section",
        gradeLevelId: GRADE_ID,
        gradeType: "G3",
        schoolId: SCHOOL_ID,
        deletedAt: null,
        adviser: null,
      },
    ];
    teacherLookup = { id: TEACHER_ID, advisorySections: [] };
    teacherProfile = { designation: "Non-DepEd ARAL Volunteer", advisoryMode: "DEFAULT" };

    const result = await add(SECTION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Volunteers/i);
    }
    expect(transaction).toHaveBeenCalled();
  });
});
