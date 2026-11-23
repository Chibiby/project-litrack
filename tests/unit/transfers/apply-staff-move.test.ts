import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyStaffSchoolMove } from "@/lib/transfers/apply-staff-move";

type Row = Record<string, unknown>;

/** A transaction fake holding only what the staff move touches. */
function fakeTx() {
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
    teacherSections: [{ teacherId: "t1", sectionId: "s-mine" }] as Row[],
  };
  const sectionOf = (id: unknown) => db.sections.find((s) => s.id === id) ?? null;
  const tx = {
    section: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.sections.filter((s) => s.schoolId === where.schoolId && s.adviserId === where.adviserId)
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Row }) => {
        const hit = db.sections.filter((s) => where.id.in.includes(s.id as string));
        for (const s of hit) Object.assign(s, data);
        return { count: hit.length };
      }),
    },
    learner: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.learners
          .filter((l) => l.schoolId === where.schoolId && l.aralTeacherId === where.aralTeacherId)
          .map((l) => ({ id: l.id, section: sectionOf(l.sectionId) }))
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = db.learners.filter((l) =>
          "id" in where
            ? (where.id as { in: string[] }).in.includes(l.id as string)
            : l.schoolId === where.schoolId && l.teacherId === where.teacherId
        );
        for (const l of hit) Object.assign(l, data);
        return { count: hit.length };
      }),
    },
    teacherSection: {
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = db.teacherSections.length;
        db.teacherSections = db.teacherSections.filter((t) => t.teacherId !== where.teacherId);
        return { count: before - db.teacherSections.length };
      }),
    },
    user: {
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const u = db.users.find((row) => row.id === where.id)!;
        return Object.assign(u, data);
      }),
    },
  };
  return { db, tx };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

describe("applyStaffSchoolMove", () => {
  it("re-tutors ARAL learners to their own section's adviser, else leaves them untutored", async () => {
    const { db, tx } = fakeTx();
    const result = await applyStaffSchoolMove(tx as never, { userId: "t1", fromSchoolId: "a", toSchoolId: "b" });

    expect(byId(db.learners, "aral-in-x").aralTeacherId).toBe("x");
    expect(byId(db.learners, "aral-in-mine").aralTeacherId).toBeNull();
    expect(byId(db.learners, "aral-no-adviser").aralTeacherId).toBeNull();
    expect(result).toEqual({ clearedSections: 1, retutored: 1, untutored: 2 });
  });

  it("leaves the advisory section with no adviser and clears adviser pointers", async () => {
    const { db, tx } = fakeTx();
    await applyStaffSchoolMove(tx as never, { userId: "t1", fromSchoolId: "a", toSchoolId: "b" });

    expect(byId(db.sections, "s-mine").adviserId).toBeNull();
    expect(byId(db.sections, "s-x").adviserId).toBe("x");
    expect(byId(db.learners, "advised").teacherId).toBeNull();
    expect(db.teacherSections).toHaveLength(0);
  });

  it("moves the account to the new school", async () => {
    const { db, tx } = fakeTx();
    await applyStaffSchoolMove(tx as never, { userId: "t1", fromSchoolId: "a", toSchoolId: "b" });

    expect(db.users[0]).toMatchObject({ schoolId: "b", advisorySectionId: null });
  });
});
