import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyLearnerSchoolMoves } from "@/lib/transfers/apply-learner-move";

type Row = Record<string, unknown>;

/**
 * A transaction fake that records every statement. `liveAtSender` is how many
 * of the named learners the guarded learner update finds, so a test can
 * simulate one being archived or moved between the check and the write.
 */
function fakeTx(opts: { liveAtSender?: number; activeYear?: boolean } = {}) {
  const calls: { model: string; op: string; args: Row }[] = [];
  const rec =
    (model: string, op: string, result: (args: Row) => unknown) =>
    vi.fn(async (args: Row) => {
      calls.push({ model, op, args });
      return result(args);
    });
  const idsOf = (args: Row) => ((args.where as Row).id as { in: string[] }).in;
  const tx = {
    learner: {
      updateMany: rec("learner", "updateMany", (a) => ({ count: opts.liveAtSender ?? idsOf(a).length })),
    },
    enrollment: {
      updateMany: rec("enrollment", "updateMany", () => ({ count: 0 })),
      createMany: rec("enrollment", "createMany", (a) => ({ count: (a.data as Row[]).length })),
    },
    schoolYear: {
      findFirst: rec("schoolYear", "findFirst", () => (opts.activeYear === false ? null : { id: "year-b" })),
    },
    sectionTransferRequest: { updateMany: rec("sectionTransferRequest", "updateMany", () => ({ count: 0 })) },
    schoolTransferRequest: { updateMany: rec("schoolTransferRequest", "updateMany", () => ({ count: 0 })) },
  };
  return { tx, calls };
}

const base = {
  fromSchoolId: "a",
  toSchoolId: "b",
  gradeLevelId: "g3",
  sectionId: "sec",
  teacherId: "adv",
  actorId: "sh-b",
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

describe("applyLearnerSchoolMoves", () => {
  it("moves any number of learners in the same fixed number of statements", async () => {
    const one = fakeTx();
    await applyLearnerSchoolMoves(one.tx as never, { ...base, learnerIds: ids(1) });
    const forty = fakeTx();
    await applyLearnerSchoolMoves(forty.tx as never, { ...base, learnerIds: ids(40) });

    expect(forty.calls.length).toBe(one.calls.length);
    expect(forty.calls.length).toBeLessThanOrEqual(7);
  });

  it("only moves live learners still at the sending school, and reports how many moved", async () => {
    const { tx, calls } = fakeTx({ liveAtSender: 1 });
    const res = await applyLearnerSchoolMoves(tx as never, { ...base, learnerIds: ids(2) });

    expect(res).toEqual({ moved: 1 });
    const move = calls.find((c) => c.model === "learner" && c.op === "updateMany")!;
    expect(move.args.where).toMatchObject({ id: { in: ids(2) }, schoolId: "a", deletedAt: null, archivedAt: null });
    expect(move.args.data).toMatchObject({
      schoolId: "b",
      gradeLevelId: "g3",
      sectionId: "sec",
      teacherId: "adv",
      aralTeacherId: null,
    });
  });

  it("closes the old active enrollments and opens one per learner at the new school", async () => {
    const { tx, calls } = fakeTx();
    await applyLearnerSchoolMoves(tx as never, { ...base, learnerIds: ids(3) });

    const closed = calls.find((c) => c.model === "enrollment" && c.op === "updateMany")!;
    expect(closed.args.where).toMatchObject({ learnerId: { in: ids(3) }, status: "ACTIVE" });
    expect(closed.args.data).toMatchObject({ status: "TRANSFERRED" });

    const created = calls.find((c) => c.model === "enrollment" && c.op === "createMany")!;
    expect(created.args.data).toEqual(
      ids(3).map((learnerId) => ({
        learnerId,
        schoolId: "b",
        schoolYearId: "year-b",
        gradeLevelId: "g3",
        sectionId: "sec",
        teacherId: "adv",
        status: "ACTIVE",
      }))
    );
    // The old row closes before the new one opens: one ACTIVE row per learner.
    expect(calls.indexOf(closed)).toBeLessThan(calls.indexOf(created));
  });

  it("writes nothing more when a learner changed, so the caller can refuse the batch", async () => {
    const { tx, calls } = fakeTx({ liveAtSender: 0 });
    const res = await applyLearnerSchoolMoves(tx as never, { ...base, learnerIds: ids(2) });

    expect(res).toEqual({ moved: 0 });
    expect(calls.map((c) => `${c.model}.${c.op}`)).toEqual(["learner.updateMany"]);
  });

  it("opens no enrollment when the receiving school has no active year", async () => {
    const { tx, calls } = fakeTx({ activeYear: false });
    await applyLearnerSchoolMoves(tx as never, { ...base, learnerIds: ids(2) });

    expect(calls.some((c) => c.op === "createMany")).toBe(false);
  });
});
