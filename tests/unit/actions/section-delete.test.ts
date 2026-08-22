import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Action-level coverage for `deleteSection` — the School Head's section removal.
 *
 * The behaviour pinned here is the teacher cache fan-out, because it is the half
 * that fails silently. `deleteSection` soft-deletes the section *and* nulls
 * `User.advisorySectionId`, and either one alone breaks `teacherGradeScope`'s
 * adviser arm — the arm `getTeacherShellContext` (tag `teacherShell`, 300s) and
 * the teacher dashboard readers (60s) resolve a teacher's grade set through. A
 * `revalidateTag` that fires with an empty id list throws nothing, which is
 * exactly how 18 dead `revalidatePath` calls survived a route removal unnoticed,
 * so a test is the only thing that can catch it.
 *
 * Two fixture choices carry the weight:
 *
 *   1. The adviser and the `TeacherSection` holders are kept DISJOINT. If the
 *      adviser were also in the `assigned` set, the assertion would pass even
 *      with the read moved after the update, and the test would be decoration.
 *   2. The `user.updateMany` fake really clears the pointer. Together with (1)
 *      that makes the first case invert if `tx.user.findMany` is ever moved below
 *      the `tx.user.updateMany` that nulls `advisorySectionId`: `advisers` would
 *      come back `[]` and the adviser's bust would silently vanish.
 *
 * Asserting on the mocked `revalidateTeacherCaches` rather than on `revalidateTag`
 * keeps the helper's fan-out and the tag-string format owned by
 * `src/lib/cache/revalidate.ts`, which is where they belong.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";
const SECTION_ID = "section-1";
const OTHER_SECTION_ID = "section-2";
const GRADE_ID = "grade-g3";
/** Holds `advisorySectionId`, and deliberately holds no `TeacherSection` row. */
const ADVISER_ID = "teacher-adviser";
/** Holds a `TeacherSection` row only, and advises nothing. */
const ASSIGNED_ID = "teacher-assigned";

type UserRow = { id: string; advisorySectionId: string | null };
type SectionRow = {
  id: string;
  name: string;
  gradeLevelId: string;
  schoolId: string;
  deletedAt: Date | null;
};
type TeacherSectionRow = { teacherId: string; sectionId: string };

let users: UserRow[];
let sectionRows: SectionRow[];
let teacherSections: TeacherSectionRow[];

function makeTx() {
  return {
    section: {
      update: vi.fn(
        async (args: { where: { id: string }; data: { deletedAt: Date } }) => {
          const row = sectionRows.find((s) => s.id === args.where.id);
          if (row) row.deletedAt = args.data.deletedAt;
          return {};
        }
      ),
    },
    learner: { updateMany: vi.fn(async () => ({ count: 0 })) },
    enrollment: { updateMany: vi.fn(async () => ({ count: 0 })) },
    user: {
      findMany: vi.fn(async (args: { where: { advisorySectionId: string } }) =>
        users
          .filter((u) => u.advisorySectionId === args.where.advisorySectionId)
          .map((u) => ({ id: u.id }))
      ),
      // Really nulls the pointer — see the header note. A fake that no-op'd here
      // would make the read-ordering hazard invisible.
      updateMany: vi.fn(async (args: { where: { advisorySectionId: string } }) => {
        let count = 0;
        for (const u of users) {
          if (u.advisorySectionId === args.where.advisorySectionId) {
            u.advisorySectionId = null;
            count += 1;
          }
        }
        return { count };
      }),
      update: vi.fn(async () => ({})),
    },
    teacherSection: {
      findMany: vi.fn(async (args: { where: { sectionId: string } }) =>
        teacherSections
          .filter((t) => t.sectionId === args.where.sectionId)
          .map((t) => ({ teacherId: t.teacherId }))
      ),
      deleteMany: vi.fn(async (args: { where: { sectionId: string } }) => {
        const before = teacherSections.length;
        teacherSections = teacherSections.filter(
          (t) => t.sectionId !== args.where.sectionId
        );
        return { count: before - teacherSections.length };
      }),
      count: vi.fn(
        async (args: {
          where: { teacherId: string; section: { gradeLevelId: string } };
        }) =>
          teacherSections.filter((t) => {
            if (t.teacherId !== args.where.teacherId) return false;
            const s = sectionRows.find((row) => row.id === t.sectionId);
            return (
              !!s &&
              s.deletedAt === null &&
              s.gradeLevelId === args.where.section.gradeLevelId
            );
          }).length
      ),
    },
  };
}

const transaction = vi.fn(
  async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx())
);

/**
 * The pre-transaction section lookup. Honours `schoolId` and `deletedAt` rather
 * than ignoring them — a fake that returned rows regardless would hide the
 * cross-tenant case this file also covers.
 */
const sectionFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string } }) => {
    const found = sectionRows.find(
      (s) =>
        s.id === args.where.id &&
        s.schoolId === args.where.schoolId &&
        s.deletedAt === null
    );
    return found ? { ...found } : null;
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
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
  AUDIT_ACTIONS: { SECTION_DELETE: "SECTION_DELETE" },
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
const { deleteSection } = await import("@/lib/actions/section");

function buildFormData(sectionId: string): FormData {
  const fd = new FormData();
  fd.set("sectionId", sectionId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  users = [
    { id: ADVISER_ID, advisorySectionId: SECTION_ID },
    { id: ASSIGNED_ID, advisorySectionId: null },
  ];
  sectionRows = [
    {
      id: SECTION_ID,
      name: "Sampaguita",
      gradeLevelId: GRADE_ID,
      schoolId: SCHOOL_ID,
      deletedAt: null,
    },
    {
      id: OTHER_SECTION_ID,
      name: "Rosal",
      gradeLevelId: GRADE_ID,
      schoolId: SCHOOL_ID,
      deletedAt: null,
    },
  ];
  teacherSections = [];
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteSection — teacher cache fan-out", () => {
  it("busts an adviser who holds no TeacherSection row for the section", async () => {
    // The required case. `teacherSections` is empty, so `tx.teacherSection.findMany`
    // returns [] and the adviser can reach the bust list only through the
    // `user.findMany` read that runs BEFORE the pointer is nulled.
    const result = await deleteSection(buildFormData(SECTION_ID));
    expect(result).toEqual({ ok: true });

    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(ADVISER_ID);
    expect(revalidateTeacherCaches).toHaveBeenCalledTimes(1);

    // The pointer really was cleared, which is what makes the assertion above
    // sensitive to the order of the read and the update rather than incidental.
    expect(users.find((u) => u.id === ADVISER_ID)?.advisorySectionId).toBeNull();

    expect(revalidateSchoolHeadTeachers).toHaveBeenCalled();
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        action: "SECTION_DELETE",
        resource: "Section",
        resourceId: SECTION_ID,
      })
    );
  });

  it("busts every TeacherSection holder too, and only once for someone who is both", async () => {
    teacherSections = [
      { teacherId: ADVISER_ID, sectionId: SECTION_ID },
      { teacherId: ASSIGNED_ID, sectionId: SECTION_ID },
    ];

    const result = await deleteSection(buildFormData(SECTION_ID));
    expect(result).toEqual({ ok: true });

    expect(revalidateTeacherCaches).toHaveBeenCalledWith(ADVISER_ID);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(ASSIGNED_ID);
    // ADVISER_ID appears in both halves of the union; the Set collapses them, so
    // two people means two calls and not three.
    expect(revalidateTeacherCaches).toHaveBeenCalledTimes(2);
  });

  it("rejects a section from another school without leaking its existence", async () => {
    sectionRows = sectionRows.map((s) =>
      s.id === SECTION_ID ? { ...s, schoolId: "school-2" } : s
    );

    const result = await deleteSection(buildFormData(SECTION_ID));
    expect(result).toEqual({ ok: false, error: "Section not found" });
    expect(JSON.stringify(result)).not.toContain("school-2");
    expect(transaction).not.toHaveBeenCalled();
    expect(revalidateTeacherCaches).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
