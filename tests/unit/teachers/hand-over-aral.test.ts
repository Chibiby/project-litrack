import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/teachers/aral-teacher", () => ({
  aralTeacherScope: (schoolId: string) => ({
    schoolId,
    role: "TEACHER",
    deletedAt: null,
    isActive: true,
    approvalStatus: "APPROVED",
  }),
}));

import { handAralLearnersToAdvisers } from "@/lib/teachers/hand-over-aral";
import { deactivateDescription, deactivatedToast } from "@/lib/teachers/removal-copy";

const SCHOOL = "school-1";
const TUTOR = "tutor-1";

function fakeTx(
  learners: { id: string; teacherId: string | null }[],
  eligibleAdvisers: string[]
) {
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const tx = {
    learner: {
      findMany: vi.fn(async () => learners),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 0 };
      }),
    },
    user: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.filter((id) => eligibleAdvisers.includes(id)).map((id) => ({ id }))
      ),
    },
  };
  return { tx, updates };
}

describe("handAralLearnersToAdvisers", () => {
  it("moves each ARAL learner to its own adviser, scoped to the school", async () => {
    const { tx, updates } = fakeTx(
      [
        { id: "l1", teacherId: "adv-a" },
        { id: "l2", teacherId: "adv-a" },
        { id: "l3", teacherId: "adv-b" },
      ],
      ["adv-a", "adv-b"]
    );

    const res = await handAralLearnersToAdvisers(tx as never, { teacherId: TUTOR, schoolId: SCHOOL });

    expect(tx.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: SCHOOL, aralTeacherId: TUTOR, isAralLearner: true, deletedAt: null },
      })
    );
    expect(res).toEqual({
      moved: [
        { adviserId: "adv-a", learnerIds: ["l1", "l2"] },
        { adviserId: "adv-b", learnerIds: ["l3"] },
      ],
      keptCount: 0,
    });
    expect(updates).toEqual([
      {
        where: { id: { in: ["l1", "l2"] }, schoolId: SCHOOL, aralTeacherId: TUTOR },
        data: { aralTeacherId: "adv-a" },
      },
      {
        where: { id: { in: ["l3"] }, schoolId: SCHOOL, aralTeacherId: TUTOR },
        data: { aralTeacherId: "adv-b" },
      },
    ]);
  });

  it("keeps learners with no adviser, the tutor as adviser, or an ineligible adviser", async () => {
    const { tx, updates } = fakeTx(
      [
        { id: "l1", teacherId: null },
        { id: "l2", teacherId: TUTOR },
        { id: "l3", teacherId: "adv-inactive" },
        { id: "l4", teacherId: "adv-a" },
      ],
      ["adv-a"]
    );

    const res = await handAralLearnersToAdvisers(tx as never, { teacherId: TUTOR, schoolId: SCHOOL });

    // The outgoing tutor is never asked about as an adviser.
    expect(tx.user.findMany.mock.calls[0][0].where.id.in).toEqual(["adv-inactive", "adv-a"]);
    expect(res).toEqual({ moved: [{ adviserId: "adv-a", learnerIds: ["l4"] }], keptCount: 3 });
    expect(updates).toHaveLength(1);
  });

  it("writes nothing when the teacher tutors no one", async () => {
    const { tx } = fakeTx([], []);
    const res = await handAralLearnersToAdvisers(tx as never, { teacherId: TUTOR, schoolId: SCHOOL });
    expect(res).toEqual({ moved: [], keptCount: 0 });
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(tx.learner.updateMany).not.toHaveBeenCalled();
  });
});

describe("deactivatedToast", () => {
  it("is plain when no ARAL learner was involved", () => {
    expect(deactivatedToast({ ok: true, data: { aralMoved: 0, aralKept: 0 } })).toBe("Teacher deactivated");
    expect(deactivatedToast({ ok: true })).toBe("Teacher deactivated");
  });

  it("says how many moved and how many still need a tutor", () => {
    expect(deactivatedToast({ ok: true, data: { aralMoved: 3, aralKept: 1 } })).toBe(
      "Teacher deactivated. 3 ARAL learners moved to their adviser. 1 ARAL learner has no adviser to take over. Assign an ARAL teacher on the Learners page."
    );
    expect(deactivatedToast({ ok: true, data: { aralMoved: 1, aralKept: 0 } })).toBe(
      "Teacher deactivated. 1 ARAL learner moved to their adviser."
    );
  });
});

describe("deactivateDescription", () => {
  it("leaves out advisory learners for a teacher with no class", () => {
    expect(deactivateDescription({ fullName: "Ana Cruz", aralLearnerCount: 2, learnerCount: 0 })).toBe(
      "Ana Cruz will not be able to sign in until reactivated. Their 2 ARAL learners will move to the learner's adviser, where the learner has an active one."
    );
  });

  it("names only what applies", () => {
    expect(deactivateDescription({ fullName: "Ana Cruz", aralLearnerCount: 1, learnerCount: 30 })).toBe(
      "Ana Cruz will not be able to sign in until reactivated. Their 1 ARAL learner will move to the learner's adviser, where the learner has an active one. Their advisory learners stay in their class."
    );
    expect(deactivateDescription({ fullName: "Ana Cruz", aralLearnerCount: 0, learnerCount: 0 })).toBe(
      "Ana Cruz will not be able to sign in until reactivated."
    );
  });
});
