import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const release = vi.hoisted(() => vi.fn(async () => ({ sectionIds: ["s-mine"], learnerCount: 2 })));
vi.mock("@/lib/teachers/release-advisory", () => ({ releaseTeacherAdvisory: release }));

import { applyStaffSchoolMove } from "@/lib/transfers/apply-staff-move";

type Row = Record<string, unknown>;

/** A transaction fake holding only what the staff move touches. */
function fakeTx(opts: { accountLive?: boolean } = {}) {
  const db = {
    sections: [
      { id: "s-mine", schoolId: "a", adviserId: "t1" },
      { id: "s-x", schoolId: "a", adviserId: "x" },
      { id: "s-none", schoolId: "a", adviserId: null },
    ] as Row[],
    learners: [
      { id: "aral-in-x", schoolId: "a", aralTeacherId: "t1", teacherId: "x", sectionId: "s-x" },
      { id: "aral-in-mine", schoolId: "a", aralTeacherId: "t1", teacherId: "t1", sectionId: "s-mine" },
      { id: "aral-no-adviser", schoolId: "a", aralTeacherId: "t1", teacherId: null, sectionId: "s-none" },
      { id: "advised", schoolId: "a", aralTeacherId: null, teacherId: "t1", sectionId: "s-mine" },
    ] as Row[],
    users: [{ id: "t1", schoolId: "a", advisorySectionId: "s-mine" }] as Row[],
  };
  const sectionOf = (id: unknown) => db.sections.find((s) => s.id === id) ?? null;
  const tx = {
    section: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.sections.filter((s) => s.schoolId === where.schoolId && s.adviserId === where.adviserId)
      ),
    },
    learner: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.learners
          .filter((l) => l.schoolId === where.schoolId && l.aralTeacherId === where.aralTeacherId)
          .map((l) => ({ id: l.id, section: sectionOf(l.sectionId) }))
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Row }) => {
        const hit = db.learners.filter((l) => where.id.in.includes(l.id as string));
        for (const l of hit) Object.assign(l, data);
        return { count: hit.length };
      }),
    },
    user: {
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (opts.accountLive === false) return { count: 0 };
        const hit = db.users.filter((u) => u.id === where.id && u.schoolId === where.schoolId);
        for (const u of hit) Object.assign(u, data);
        return { count: hit.length };
      }),
    },
  };
  return { db, tx };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;
const move = { userId: "t1", fromSchoolId: "a", toSchoolId: "b" };

describe("applyStaffSchoolMove", () => {
  it("re-tutors ARAL learners to their own section's adviser, else leaves them untutored", async () => {
    const { db, tx } = fakeTx();
    const result = await applyStaffSchoolMove(tx as never, move);

    expect(byId(db.learners, "aral-in-x").aralTeacherId).toBe("x");
    expect(byId(db.learners, "aral-in-mine").aralTeacherId).toBeNull();
    expect(byId(db.learners, "aral-no-adviser").aralTeacherId).toBeNull();
    expect(result).toEqual({ clearedSections: 1, retutored: 1, untutored: 2 });
  });

  it("releases the advisory at the old school the way removal does", async () => {
    release.mockClear();
    const { tx } = fakeTx();
    await applyStaffSchoolMove(tx as never, move);

    // releaseTeacherAdvisory clears Section.adviserId, Learner.teacherId, the
    // ACTIVE Enrollment.teacherId and the taughtGrades/TeacherSection mirrors
    // together, scoped to the old school.
    expect(release).toHaveBeenCalledWith(tx, { teacherId: "t1", schoolId: "a" });
  });

  it("re-tutors before the release, so tutored learners are not just cleared", async () => {
    release.mockClear();
    const { tx } = fakeTx();
    await applyStaffSchoolMove(tx as never, move);

    const retutor = tx.learner.updateMany.mock.invocationCallOrder[0];
    expect(retutor).toBeLessThan(release.mock.invocationCallOrder[0]);
  });

  it("moves the account only while it is live at the sending school", async () => {
    const { db, tx } = fakeTx();
    await applyStaffSchoolMove(tx as never, move);

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", schoolId: "a", deletedAt: null, isActive: true },
      data: { schoolId: "b", advisorySectionId: null },
    });
    expect(db.users[0]).toMatchObject({ schoolId: "b", advisorySectionId: null });
  });

  it("refuses when the account was removed or moved after the check", async () => {
    release.mockClear();
    const { tx } = fakeTx({ accountLive: false });

    await expect(applyStaffSchoolMove(tx as never, move)).rejects.toMatchObject({ code: "TRANSFER_REQUESTS_CHANGED" });
    expect(release).not.toHaveBeenCalled();
  });
});
