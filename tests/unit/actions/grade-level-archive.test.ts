import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * §7 of the ten concerns: deactivating a grade set up by mistake, and bringing
 * one back.
 *
 * Three things carry the weight here, and each is a rule the interface cannot
 * enforce on its own:
 *
 *   1. **The refusal.** A grade holding learners must not archive. Everything
 *      else in this feature is convenience; this is the safety property. Hiding
 *      a class of real learners behind a toggle would drop them out of every
 *      roster, dashboard and report at once, and `GRADE_LEVEL_ARCHIVE` would be
 *      the only record it happened.
 *   2. **The shared timestamp.** Restore tells "archived with this grade" from
 *      "archived earlier, on purpose" by matching `Section.deletedAt` to the
 *      grade's exactly. If the grade and its sections were stamped from two
 *      `new Date()` calls they would differ by a millisecond and restore would
 *      bring nothing back — a failure that looks like data loss and throws
 *      nothing. The fixture keeps a separately-deleted section around so the
 *      match is proved to be exact rather than "any deleted section".
 *   3. **The adviser fan-out.** Same hazard `section-delete.test.ts` documents:
 *      the advisers are read BEFORE their pointer is nulled, and the fake below
 *      really nulls it, so moving that read after the write inverts the test
 *      instead of silently passing.
 */

const HEAD_ID = "head-remedios";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const GRADE_ID = "grade-g4";
const FOREIGN_GRADE_ID = "grade-kiblawan-g4";
const SECTION_A = "section-sampaguita";
const SECTION_B = "section-rosal";
/** Deleted last term, on its own. Restoring the grade must not revive it. */
const SECTION_OLD = "section-ilang-ilang";
const ADVISER_ID = "teacher-adviser";
/** Holds a `TeacherSection` row only, and advises nothing — kept disjoint. */
const ASSIGNED_ID = "teacher-assigned";
/** Linked only through the legacy `taughtGrades` mirror. */
const LINKED_ID = "teacher-linked";

/** An earlier, unrelated deletion. Deliberately not the archive timestamp. */
const OLD_DELETION = new Date(2026, 4, 1, 9, 30, 0);

type GradeRow = { id: string; type: string; schoolId: string; deletedAt: Date | null };
type SectionRow = { id: string; gradeLevelId: string; deletedAt: Date | null };
type UserRow = {
  id: string;
  advisorySectionId: string | null;
  taughtGradeIds: string[];
};

let grades: GradeRow[];
let sections: SectionRow[];
let users: UserRow[];
let teacherSections: { teacherId: string; sectionId: string }[];
let learnerCount: number;

function makeTx() {
  return {
    gradeLevel: {
      update: vi.fn(
        async (args: { where: { id: string }; data: { deletedAt: Date | null } }) => {
          const row = grades.find((g) => g.id === args.where.id);
          if (row) row.deletedAt = args.data.deletedAt;
          return {};
        }
      ),
    },
    section: {
      findMany: vi.fn(
        async (args: { where: { gradeLevelId: string; deletedAt: null } }) =>
          sections
            .filter(
              (s) =>
                s.gradeLevelId === args.where.gradeLevelId && s.deletedAt === null
            )
            .map((s) => ({ id: s.id }))
      ),
      updateMany: vi.fn(
        async (args: {
          where: { id?: { in: string[] }; gradeLevelId?: string; deletedAt?: Date };
          data: { deletedAt: Date | null };
        }) => {
          let count = 0;
          for (const s of sections) {
            if (args.where.id && !args.where.id.in.includes(s.id)) continue;
            if (args.where.gradeLevelId && s.gradeLevelId !== args.where.gradeLevelId)
              continue;
            // Exact timestamp equality, which is the whole point of the pairing.
            if (
              args.where.deletedAt !== undefined &&
              s.deletedAt?.getTime() !== args.where.deletedAt.getTime()
            )
              continue;
            s.deletedAt = args.data.deletedAt;
            count += 1;
          }
          return { count };
        }
      ),
    },
    user: {
      findMany: vi.fn(
        async (args: {
          where: {
            advisorySectionId?: { in: string[] };
            taughtGrades?: { some: { id: string } };
          };
        }) => {
          if (args.where.advisorySectionId) {
            const ids = args.where.advisorySectionId.in;
            return users
              .filter((u) => u.advisorySectionId && ids.includes(u.advisorySectionId))
              .map((u) => ({ id: u.id }));
          }
          const gradeId = args.where.taughtGrades!.some.id;
          return users
            .filter((u) => u.taughtGradeIds.includes(gradeId))
            .map((u) => ({ id: u.id }));
        }
      ),
      // Really clears the pointer — see note 3 in the header.
      updateMany: vi.fn(
        async (args: { where: { advisorySectionId: { in: string[] } } }) => {
          let count = 0;
          for (const u of users) {
            if (u.advisorySectionId && args.where.advisorySectionId.in.includes(u.advisorySectionId)) {
              u.advisorySectionId = null;
              count += 1;
            }
          }
          return { count };
        }
      ),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { taughtGrades: { disconnect: { id: string } } };
        }) => {
          const u = users.find((x) => x.id === args.where.id);
          if (u) {
            u.taughtGradeIds = u.taughtGradeIds.filter(
              (g) => g !== args.data.taughtGrades.disconnect.id
            );
          }
          return {};
        }
      ),
    },
    teacherSection: {
      findMany: vi.fn(async (args: { where: { sectionId: { in: string[] } } }) =>
        teacherSections
          .filter((t) => args.where.sectionId.in.includes(t.sectionId))
          .map((t) => ({ teacherId: t.teacherId }))
      ),
      deleteMany: vi.fn(async (args: { where: { sectionId: { in: string[] } } }) => {
        const before = teacherSections.length;
        teacherSections = teacherSections.filter(
          (t) => !args.where.sectionId.in.includes(t.sectionId)
        );
        return { count: before - teacherSections.length };
      }),
    },
  };
}

const transaction = vi.fn(
  async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx())
);

/** Honours schoolId and the deletedAt direction, so the tenant cases are real. */
const gradeFindFirst = vi.fn(
  async (args: {
    where: { id: string; schoolId: string; deletedAt: null | { not: null } };
  }) => {
    const found = grades.find((g) => {
      if (g.id !== args.where.id) return false;
      if (g.schoolId !== args.where.schoolId) return false;
      return args.where.deletedAt === null ? g.deletedAt === null : g.deletedAt !== null;
    });
    return found ? { ...found } : null;
  }
);

const learnerCountFn = vi.fn(async (..._args: unknown[]) => learnerCount);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    gradeLevel: {
      findFirst: (...args: unknown[]) => gradeFindFirst(...(args as [never])),
    },
    learner: { count: (...args: unknown[]) => learnerCountFn(...(args as [])) },
  },
}));

const requireSchoolUser = vi.fn(async () => ({ id: HEAD_ID, schoolId: SCHOOL_ID }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async (..._args: unknown[]) => {});
const writeAuditMany = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  writeAuditMany: (...args: unknown[]) => writeAuditMany(...(args as [])),
  AUDIT_ACTIONS: {
    GRADE_LEVEL_ARCHIVE: "GRADE_LEVEL_ARCHIVE",
    GRADE_LEVEL_RESTORE: "GRADE_LEVEL_RESTORE",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

const revalidateTeacherCaches = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTeacherCaches: (...args: unknown[]) =>
    revalidateTeacherCaches(...(args as [])),
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/auth/delete-auth-user", () => ({ deleteAuthUser: vi.fn() }));

import { archiveGradeLevel, restoreGradeLevel } from "@/lib/actions/school-head";

function fd(gradeLevelId: string): FormData {
  const form = new FormData();
  form.set("gradeLevelId", gradeLevelId);
  return form;
}

const archivedGrade = () => grades.find((g) => g.id === GRADE_ID)!;
const sectionRow = (id: string) => sections.find((s) => s.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  learnerCount = 0;
  grades = [
    { id: GRADE_ID, type: "G4", schoolId: SCHOOL_ID, deletedAt: null },
    { id: FOREIGN_GRADE_ID, type: "G4", schoolId: OTHER_SCHOOL_ID, deletedAt: null },
  ];
  sections = [
    { id: SECTION_A, gradeLevelId: GRADE_ID, deletedAt: null },
    { id: SECTION_B, gradeLevelId: GRADE_ID, deletedAt: null },
    { id: SECTION_OLD, gradeLevelId: GRADE_ID, deletedAt: OLD_DELETION },
  ];
  users = [
    { id: ADVISER_ID, advisorySectionId: SECTION_A, taughtGradeIds: [] },
    { id: ASSIGNED_ID, advisorySectionId: null, taughtGradeIds: [] },
    { id: LINKED_ID, advisorySectionId: null, taughtGradeIds: [GRADE_ID] },
  ];
  teacherSections = [{ teacherId: ASSIGNED_ID, sectionId: SECTION_B }];
});

describe("archiveGradeLevel — the refusal", () => {
  it("refuses while the grade still holds learners, and names the count", async () => {
    learnerCount = 23;

    const res = await archiveGradeLevel(fd(GRADE_ID));

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({
      error: expect.stringContaining("23 learners"),
    });
    // Named, so the head knows which grade refused without reading the row.
    expect((res as { error: string }).error).toContain("Grade 4");
    // Nothing at all was written.
    expect(transaction).not.toHaveBeenCalled();
    expect(archivedGrade().deletedAt).toBeNull();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("says learner, not learners, when there is one", async () => {
    learnerCount = 1;

    const res = await archiveGradeLevel(fd(GRADE_ID));

    expect((res as { error: string }).error).toContain("1 learner.");
  });

  it("counts learners scoped to the school and excluding soft-deleted rows", async () => {
    learnerCount = 1;
    await archiveGradeLevel(fd(GRADE_ID));

    // An archived learner still counts — they can be brought back, and bringing
    // one back into a deactivated grade would put them where nobody can see.
    expect(learnerCountFn.mock.calls[0][0]).toEqual({
      where: { gradeLevelId: GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null },
    });
  });

  it("refuses a grade in another school as simply not found", async () => {
    const res = await archiveGradeLevel(fd(FOREIGN_GRADE_ID));

    expect(res).toEqual({ ok: false, error: "Grade level not found" });
    // Never even asks how many learners are in it — existence must not leak.
    expect(learnerCountFn).not.toHaveBeenCalled();
  });

  it("refuses a grade that is already deactivated", async () => {
    archivedGrade().deletedAt = new Date();

    expect(await archiveGradeLevel(fd(GRADE_ID))).toEqual({
      ok: false,
      error: "Grade level not found",
    });
  });
});

describe("archiveGradeLevel — an empty grade", () => {
  it("archives the grade and its live sections on one timestamp", async () => {
    const res = await archiveGradeLevel(fd(GRADE_ID));

    expect(res).toEqual({ ok: true });
    const stamp = archivedGrade().deletedAt;
    expect(stamp).toBeInstanceOf(Date);
    // The pairing restore depends on: identical, not merely close.
    expect(sectionRow(SECTION_A).deletedAt?.getTime()).toBe(stamp!.getTime());
    expect(sectionRow(SECTION_B).deletedAt?.getTime()).toBe(stamp!.getTime());
  });

  it("leaves a separately deleted section on its own timestamp", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    expect(sectionRow(SECTION_OLD).deletedAt).toBe(OLD_DELETION);
  });

  it("frees the advisers of the sections it takes down", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    expect(users.find((u) => u.id === ADVISER_ID)!.advisorySectionId).toBeNull();
  });

  it("busts the caches of every teacher it touched", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    const busted = revalidateTeacherCaches.mock.calls.map((c) => c[0]);
    // The adviser, the TeacherSection holder and the taughtGrades link are three
    // different teachers on purpose: a fan-out that covered only one of the
    // three would pass if they were the same person.
    expect(new Set(busted)).toEqual(
      new Set([ADVISER_ID, ASSIGNED_ID, LINKED_ID])
    );
  });

  it("drops the legacy taughtGrades link to the archived grade", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    expect(users.find((u) => u.id === LINKED_ID)!.taughtGradeIds).toEqual([]);
  });

  it("audits with counts and the grade's identity, never a teacher's", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    const row = writeAudit.mock.calls[0][0] as {
      action: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    };
    expect(row.action).toBe("GRADE_LEVEL_ARCHIVE");
    expect(row.resourceId).toBe(GRADE_ID);
    expect(row.metadata).toMatchObject({ type: "G4", freedTeachers: 3 });
    expect(JSON.stringify(row.metadata)).not.toContain(ADVISER_ID);
  });

  it("revalidates the grade levels page", async () => {
    await archiveGradeLevel(fd(GRADE_ID));

    expect(revalidatePath).toHaveBeenCalledWith(
      SCHOOL_HEAD_ROUTES.schoolGradeLevels
    );
  });
});

describe("restoreGradeLevel", () => {
  /** Archive first, so restore runs against the state archive really produced. */
  async function archiveThenRestore() {
    await archiveGradeLevel(fd(GRADE_ID));
    vi.clearAllMocks();
    return restoreGradeLevel(fd(GRADE_ID));
  }

  it("brings back the grade and the sections archived with it", async () => {
    const res = await archiveThenRestore();

    expect(res).toEqual({ ok: true });
    expect(archivedGrade().deletedAt).toBeNull();
    expect(sectionRow(SECTION_A).deletedAt).toBeNull();
    expect(sectionRow(SECTION_B).deletedAt).toBeNull();
  });

  it("does not revive a section that was deleted separately", async () => {
    await archiveThenRestore();

    // The head deleted this one last term. The grade coming back is not a
    // reason to undo that.
    expect(sectionRow(SECTION_OLD).deletedAt).toBe(OLD_DELETION);
  });

  it("does not re-attach the adviser it freed", async () => {
    await archiveThenRestore();

    // `Section.adviserId` is unique and the teacher may hold another section by
    // now; a head reassigns from the teachers table.
    expect(users.find((u) => u.id === ADVISER_ID)!.advisorySectionId).toBeNull();
  });

  it("audits the restore with the number of sections it brought back", async () => {
    await archiveThenRestore();

    const row = writeAudit.mock.calls[0][0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(row.action).toBe("GRADE_LEVEL_RESTORE");
    expect(row.metadata).toMatchObject({ type: "G4", restoredSections: 2 });
  });

  it("refuses a grade that is not deactivated", async () => {
    expect(await restoreGradeLevel(fd(GRADE_ID))).toEqual({
      ok: false,
      error: "Grade level not found",
    });
  });

  it("refuses a deactivated grade in another school", async () => {
    grades.find((g) => g.id === FOREIGN_GRADE_ID)!.deletedAt = new Date();

    expect(await restoreGradeLevel(fd(FOREIGN_GRADE_ID))).toEqual({
      ok: false,
      error: "Grade level not found",
    });
  });
});

describe("both actions — input", () => {
  it.each([archiveGradeLevel, restoreGradeLevel])(
    "rejects a missing id before touching the database",
    async (action) => {
      expect(await action(new FormData())).toEqual({
        ok: false,
        error: "Grade level required",
      });
      expect(gradeFindFirst).not.toHaveBeenCalled();
    }
  );

  it.each([archiveGradeLevel, restoreGradeLevel])(
    "answers an id that matches no row with the same generic not-found",
    async (action) => {
      // Deliberately NOT a separate "malformed id" error: one condition, one
      // answer, so nothing can be learned from which wording comes back.
      expect(await action(fd("not-an-id-at-all"))).toEqual({
        ok: false,
        error: "Grade level not found",
      });
    }
  );
});
