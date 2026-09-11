import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Action-level coverage for `setTeacherAdvisorySetting` — the School Head's
 * control for a teacher's designation and advisory mode.
 *
 * The behaviour worth pinning here is the release confirmation: lowering the
 * cap below what a teacher currently holds must not silently strip sections.
 * The action instead returns `confirm_release` naming exactly which sections
 * would be freed, and only writes once the School Head calls back with
 * `confirmRelease: "true"`. Releases route through the real
 * `setTeacherAdvisory`, so the legacy `TeacherSection` / `taughtGrades`
 * mirrors are genuinely exercised, not assumed.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";
const TEACHER_ID = "33333333-3333-4333-8333-333333333333";

type SectionRow = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeType: string;
  schoolId: string;
  deletedAt: Date | null;
  adviser: { id: string; fullName: string } | null;
};

let sections: SectionRow[];
let teacherLookup:
  | {
      id: string;
      fullName: string;
      teacherProfile: { designation: string; advisoryMode: string } | null;
    }
  | null;
let calls: {
  teacherProfileUpdate: unknown[];
  sectionUpdateMany: unknown[];
};

function advisorySectionsOf(teacherId: string) {
  return sections
    .filter((s) => s.adviser?.id === teacherId && s.deletedAt === null)
    .sort((a, b) => (a.gradeType === b.gradeType ? a.name.localeCompare(b.name) : a.gradeType.localeCompare(b.gradeType)))
    .map((s) => ({ id: s.id, name: s.name, gradeLevel: { type: s.gradeType } }));
}

function makeTx() {
  return {
    teacherProfile: {
      update: vi.fn(async (args: unknown) => {
        calls.teacherProfileUpdate.push(args);
        return {};
      }),
      // Used internally by setTeacherAdvisory's cap check on `add` — not
      // reached by this action (it only ever removes), but present so a
      // future add-path would not crash against an undefined mock.
      findFirst: vi.fn(async () => ({
        designation: teacherLookup?.teacherProfile?.designation ?? "Teacher",
        advisoryMode: teacherLookup?.teacherProfile?.advisoryMode ?? "DEFAULT",
      })),
    },
    section: {
      findMany: vi.fn(
        async (args: {
          where: { adviserId?: string; schoolId: string; deletedAt: null };
        }) => {
          const rows = sections.filter((s) => {
            if (s.schoolId !== args.where.schoolId) return false;
            if (s.deletedAt !== null) return false;
            if (args.where.adviserId && s.adviser?.id !== args.where.adviserId) return false;
            return true;
          });
          return rows.map((s) => ({ id: s.id, name: s.name, gradeLevelId: s.gradeLevelId }));
        }
      ),
      updateMany: vi.fn(
        async (args: {
          where: { id?: string; adviserId?: string | null; schoolId: string };
          data: { adviserId: string | null };
        }) => {
          calls.sectionUpdateMany.push(args);
          let count = 0;
          for (const s of sections) {
            if (s.schoolId !== args.where.schoolId) continue;
            if (args.where.id && s.id !== args.where.id) continue;
            s.adviser = args.data.adviserId ? { id: args.data.adviserId, fullName: "Marivic Cruz" } : null;
            count += 1;
          }
          return { count };
        }
      ),
    },
    teacherSection: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        advisorySectionId: advisorySectionsOf(TEACHER_ID)[0]?.id ?? null,
        taughtGrades: [...new Set(advisorySectionsOf(TEACHER_ID).map(() => "grade-g3"))].map((id) => ({ id })),
      })),
      update: vi.fn(async () => ({})),
    },
  };
}

const transaction = vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()));

const userFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string; role: string; deletedAt: null } }) => {
    if (!teacherLookup) return null;
    if (teacherLookup.id !== args.where.id) return null;
    if (args.where.schoolId !== SCHOOL_ID) return null;
    return {
      id: teacherLookup.id,
      fullName: teacherLookup.fullName,
      teacherProfile: teacherLookup.teacherProfile,
      advisorySections: advisorySectionsOf(teacherLookup.id),
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
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  AUDIT_ACTIONS: {
    TEACHER_SET_ADVISORY_SECTION: "TEACHER_SET_ADVISORY_SECTION",
    TEACHER_ADVISORY_SETTING_CHANGE: "TEACHER_ADVISORY_SETTING_CHANGE",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

const revalidateTeacherCaches = vi.fn();
const revalidateSchoolDashboard = vi.fn();
const revalidateSchoolHeadTeachers = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTeacherCaches: (...args: unknown[]) => revalidateTeacherCaches(...(args as [])),
  revalidateSchoolDashboard: (...args: unknown[]) => revalidateSchoolDashboard(...(args as [])),
  revalidateSchoolHeadTeachers: (...args: unknown[]) => revalidateSchoolHeadTeachers(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { setTeacherAdvisorySetting } = await import("@/lib/actions/teacher");

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function holding(count: number) {
  const ids = [
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];
  sections = [];
  for (let i = 0; i < count; i += 1) {
    sections.push({
      id: ids[i],
      name: `Section ${i}`,
      gradeLevelId: "grade-g3",
      gradeType: "G3",
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviser: { id: TEACHER_ID, fullName: "Marivic Cruz" },
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  sections = [];
  teacherLookup = {
    id: TEACHER_ID,
    fullName: "Marivic Cruz",
    teacherProfile: { designation: "Teacher", advisoryMode: "DEFAULT" },
  };
  calls = { teacherProfileUpdate: [], sectionUpdateMany: [] };
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setTeacherAdvisorySetting", () => {
  it("refuses without confirmation when MULTI_GRADE holding 3 drops to DEFAULT", async () => {
    holding(3);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "MULTI_GRADE" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({ teacherId: TEACHER_ID, designationKind: "Teacher", advisoryMode: "DEFAULT" })
    );

    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(result).toEqual({
      ok: false,
      error: "confirm_release",
      releases: [
        { id: "77777777-7777-4777-8777-777777777777", label: "Grade 3 · Section 1" },
        { id: "88888888-8888-4888-8888-888888888888", label: "Grade 3 · Section 2" },
      ],
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(calls.teacherProfileUpdate).toHaveLength(0);
  });

  it("releases the excess and writes the update once confirmed", async () => {
    holding(3);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "MULTI_GRADE" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({
        teacherId: TEACHER_ID,
        designationKind: "Teacher",
        advisoryMode: "DEFAULT",
        confirmRelease: "true",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(calls.teacherProfileUpdate[0]).toEqual({
      where: { userId: TEACHER_ID },
      data: { designation: "Teacher", advisoryMode: "DEFAULT" },
    });
    // Two removes: sections 1 and 2, the ones kept out of the first slot.
    expect(calls.sectionUpdateMany).toHaveLength(2);
    for (const call of calls.sectionUpdateMany) {
      expect((call as { data: { adviserId: string | null } }).data.adviserId).toBeNull();
    }

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        schoolId: SCHOOL_ID,
        action: "TEACHER_ADVISORY_SETTING_CHANGE",
        resource: "TeacherProfile",
        resourceId: TEACHER_ID,
        metadata: expect.objectContaining({
          teacherId: TEACHER_ID,
          previousDesignation: "Teacher",
          designation: "Teacher",
          previousMode: "MULTI_GRADE",
          advisoryMode: "DEFAULT",
          releasedSectionIds: [
            "77777777-7777-4777-8777-777777777777",
            "88888888-8888-4888-8888-888888888888",
          ],
        }),
      })
    );
    expect(revalidateSchoolHeadTeachers).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/settings/profile");
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ID);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
  });

  it("refuses without confirmation when DEFAULT holding 1 switches to FLOATING", async () => {
    holding(1);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "DEFAULT" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({ teacherId: TEACHER_ID, designationKind: "Teacher", advisoryMode: "FLOATING" })
    );

    expect(result).toEqual({
      ok: false,
      error: "confirm_release",
      releases: [{ id: "66666666-6666-4666-8666-666666666666", label: "Grade 3 · Section 0" }],
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("switches Teacher to Volunteer with no sections held and no release", async () => {
    holding(0);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "DEFAULT" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({
        teacherId: TEACHER_ID,
        designationKind: "Non-DepEd ARAL Volunteer",
        advisoryMode: "DEFAULT",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(calls.sectionUpdateMany).toHaveLength(0);
    expect(calls.teacherProfileUpdate[0]).toEqual({
      where: { userId: TEACHER_ID },
      data: { designation: "Non-DepEd ARAL Volunteer", advisoryMode: "DEFAULT" },
    });
  });

  it("persists a free-text __OTHER__ designation", async () => {
    holding(0);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "DEFAULT" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({
        teacherId: TEACHER_ID,
        designationKind: "__OTHER__",
        designationOther: "ARAL Coordinator",
        advisoryMode: "DEFAULT",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(calls.teacherProfileUpdate[0]).toEqual({
      where: { userId: TEACHER_ID },
      data: { designation: "ARAL Coordinator", advisoryMode: "DEFAULT" },
    });
  });

  it("rejects __OTHER__ with empty text", async () => {
    const result = await setTeacherAdvisorySetting(
      buildFormData({
        teacherId: TEACHER_ID,
        designationKind: "__OTHER__",
        designationOther: "",
        advisoryMode: "DEFAULT",
      })
    );

    expect(result.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a teacher from another school without leaking their existence", async () => {
    teacherLookup = null;

    const result = await setTeacherAdvisorySetting(
      buildFormData({ teacherId: TEACHER_ID, designationKind: "Teacher", advisoryMode: "DEFAULT" })
    );

    expect(result).toEqual({ ok: false, error: "Teacher not found" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses when the teacher hasn't finished profiling", async () => {
    teacherLookup!.teacherProfile = null;

    const result = await setTeacherAdvisorySetting(
      buildFormData({ teacherId: TEACHER_ID, designationKind: "Teacher", advisoryMode: "DEFAULT" })
    );

    expect(result).toEqual({ ok: false, error: "This teacher hasn't finished profiling yet." });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("is a no-op, with no audit row, when the setting is unchanged", async () => {
    holding(1);
    teacherLookup!.teacherProfile = { designation: "Teacher", advisoryMode: "DEFAULT" };

    const result = await setTeacherAdvisorySetting(
      buildFormData({ teacherId: TEACHER_ID, designationKind: "Teacher", advisoryMode: "DEFAULT" })
    );

    expect(result).toEqual({ ok: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
