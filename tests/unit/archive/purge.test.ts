import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/archive/purge.ts` — the permanent-delete half of `/admin/archive`.
 *
 * The counts here are what the confirm dialog quotes to an admin before an
 * irreversible action (spec section 5's exact sentence), so a wrong count is
 * a real defect, not a cosmetic one.
 *
 * The one property worth more than the counts: `purgeTeacherRecord` must
 * release the advisory and null every learner's `teacherId` BEFORE it deletes
 * the `User` row, because `Learner.teacherId` is still `ON DELETE RESTRICT`
 * (spec 2b) — deleting first would fail with P2003. Order is asserted
 * explicitly below, not merely "both happened".
 */

const releaseTeacherAdvisory = vi.fn(
  async (_tx: unknown, _params: { teacherId: string; schoolId: string }) => {
    order.push("releaseTeacherAdvisory");
    return { sectionIds: ["section-a", "section-b"], learnerCount: 4 };
  }
);
vi.mock("@/lib/teachers/release-advisory", () => ({
  releaseTeacherAdvisory: (...args: unknown[]) =>
    releaseTeacherAdvisory(...(args as [never, never])),
}));

import { learnerPurgeCounts, purgeLearnerRecord, purgeTeacherRecord, teacherPurgeCounts } from "@/lib/archive/purge";

const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-1";
const LEARNER_ID = "learner-1";

/** Records the sequence of side-effecting calls across the fake tx and the mock. */
let order: string[];
/** How many rows the final `deleteMany` guard reports finding; 1 = the normal case. */
let learnerDeleteManyCount: number;
let userDeleteManyCount: number;

function countStub(name: string, value: number) {
  return vi.fn(async (_args: unknown) => {
    order.push(`count:${name}`);
    return value;
  });
}

function makeTx(counts: Record<string, number> = {}) {
  return {
    enrollment: { count: countStub("enrollment", counts.enrollment ?? 0) },
    attendance: { count: countStub("attendance", counts.attendance ?? 0) },
    readingLevelRecord: { count: countStub("readingLevelRecord", counts.readingLevelRecord ?? 0) },
    termGrade: { count: countStub("termGrade", counts.termGrade ?? 0) },
    aralProfile: { count: countStub("aralProfile", counts.aralProfile ?? 0) },
    teacherSection: { count: countStub("teacherSection", counts.teacherSection ?? 0) },
    notification: { count: countStub("notification", counts.notification ?? 0) },
    chatMessage: { count: countStub("chatMessage", counts.chatMessage ?? 0) },
    chatMention: { count: countStub("chatMention", counts.chatMention ?? 0) },
    chatRead: { count: countStub("chatRead", counts.chatRead ?? 0) },
    supportTicket: { count: countStub("supportTicket", counts.supportTicket ?? 0) },
    unlockGrant: { count: countStub("unlockGrant", counts.unlockGrant ?? 0) },
    learner: {
      deleteMany: vi.fn(async (_args: unknown) => {
        order.push("learner.deleteMany");
        return { count: learnerDeleteManyCount };
      }),
      updateMany: vi.fn(async (_args: unknown) => {
        order.push("learner.updateMany");
        return { count: 4 };
      }),
    },
    user: {
      update: vi.fn(async (_args: { where: { id: string }; data: { advisorySectionId: null } }) => {
        order.push("user.update:advisorySectionId");
        return {};
      }),
      deleteMany: vi.fn(async (_args: unknown) => {
        order.push("user.deleteMany");
        return { count: userDeleteManyCount };
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  learnerDeleteManyCount = 1;
  userDeleteManyCount = 1;
});

describe("learnerPurgeCounts", () => {
  it("counts all five learner-scoped tables by learnerId", async () => {
    const tx = makeTx({ enrollment: 2, attendance: 40, readingLevelRecord: 6, termGrade: 8, aralProfile: 1 });

    const counts = await learnerPurgeCounts(tx, LEARNER_ID);

    expect(counts).toEqual({
      enrollment: 2,
      attendance: 40,
      readingLevelRecord: 6,
      termGrade: 8,
      aralProfile: 1,
    });
    expect(tx.enrollment.count).toHaveBeenCalledWith({ where: { learnerId: LEARNER_ID } });
    expect(tx.attendance.count).toHaveBeenCalledWith({ where: { learnerId: LEARNER_ID } });
    expect(tx.readingLevelRecord.count).toHaveBeenCalledWith({ where: { learnerId: LEARNER_ID } });
    expect(tx.termGrade.count).toHaveBeenCalledWith({ where: { learnerId: LEARNER_ID } });
    expect(tx.aralProfile.count).toHaveBeenCalledWith({ where: { learnerId: LEARNER_ID } });
  });
});

describe("teacherPurgeCounts", () => {
  it("counts all seven teacher-scoped tables on the right column each", async () => {
    const tx = makeTx({
      teacherSection: 3,
      notification: 5,
      chatMessage: 12,
      chatMention: 2,
      chatRead: 9,
      supportTicket: 1,
      unlockGrant: 4,
    });

    const counts = await teacherPurgeCounts(tx, TEACHER_ID);

    expect(counts).toEqual({
      teacherSection: 3,
      notification: 5,
      chatMessage: 12,
      chatMention: 2,
      chatRead: 9,
      supportTicket: 1,
      unlockGrant: 4,
    });
    expect(tx.teacherSection.count).toHaveBeenCalledWith({ where: { teacherId: TEACHER_ID } });
    expect(tx.notification.count).toHaveBeenCalledWith({ where: { recipientId: TEACHER_ID } });
    expect(tx.chatMessage.count).toHaveBeenCalledWith({ where: { authorId: TEACHER_ID } });
    expect(tx.chatMention.count).toHaveBeenCalledWith({ where: { userId: TEACHER_ID } });
    expect(tx.chatRead.count).toHaveBeenCalledWith({ where: { userId: TEACHER_ID } });
    expect(tx.supportTicket.count).toHaveBeenCalledWith({ where: { requesterId: TEACHER_ID } });
    expect(tx.unlockGrant.count).toHaveBeenCalledWith({ where: { userId: TEACHER_ID } });
  });
});

describe("purgeLearnerRecord", () => {
  it("reads the counts before deleting, and returns the pre-delete counts", async () => {
    const tx = makeTx({ enrollment: 1, attendance: 10, readingLevelRecord: 2, termGrade: 3, aralProfile: 1 });

    const counts = await purgeLearnerRecord(tx, LEARNER_ID);

    expect(counts).toEqual({ enrollment: 1, attendance: 10, readingLevelRecord: 2, termGrade: 3, aralProfile: 1 });
    // The delete is a `deleteMany` guarded by `deletedAt: { not: null }` on the
    // statement itself — not merely on an earlier read — so a live row can
    // never be reachable here even under a concurrent purge race.
    expect(tx.learner.deleteMany).toHaveBeenCalledWith({
      where: { id: LEARNER_ID, deletedAt: { not: null } },
    });
    // Counts read before the row they count is gone.
    const deleteIndex = order.indexOf("learner.deleteMany");
    expect(deleteIndex).toBeGreaterThan(0);
    expect(order.slice(0, deleteIndex)).toEqual(
      expect.arrayContaining(["count:enrollment", "count:attendance", "count:readingLevelRecord", "count:termGrade", "count:aralProfile"])
    );
  });

  it("refuses when the guarded deleteMany matches no row (e.g. a concurrent purge already removed it)", async () => {
    learnerDeleteManyCount = 0;
    const tx = makeTx();

    await expect(purgeLearnerRecord(tx, LEARNER_ID)).rejects.toThrow();
  });
});

describe("purgeTeacherRecord — ordering", () => {
  it("releases advisory and nulls learner.teacherId BEFORE deleting the User row", async () => {
    const tx = makeTx();

    await purgeTeacherRecord(tx, { teacherId: TEACHER_ID, schoolId: SCHOOL_ID });

    const advisoryIndex = order.indexOf("releaseTeacherAdvisory");
    const learnerNullIndex = order.indexOf("learner.updateMany");
    const advisorySectionNullIndex = order.indexOf("user.update:advisorySectionId");
    const deleteIndex = order.indexOf("user.deleteMany");

    expect(advisoryIndex).toBeGreaterThanOrEqual(0);
    expect(learnerNullIndex).toBeGreaterThanOrEqual(0);
    expect(advisorySectionNullIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThanOrEqual(0);

    // The real assertion: every resolving write happens strictly before the
    // delete, not merely "was called at some point during the function".
    expect(advisoryIndex).toBeLessThan(deleteIndex);
    expect(learnerNullIndex).toBeLessThan(deleteIndex);
    expect(advisorySectionNullIndex).toBeLessThan(deleteIndex);

    // user.deleteMany must be the LAST write, since it is what the RESTRICT
    // FK would reject if any learner still named this teacher.
    expect(deleteIndex).toBe(order.length - 1);
  });

  it("scopes releaseTeacherAdvisory and the unscoped learner null to the purged teacher, and guards the delete with deletedAt: { not: null }", async () => {
    const tx = makeTx();

    await purgeTeacherRecord(tx, { teacherId: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(releaseTeacherAdvisory).toHaveBeenCalledWith(tx, { teacherId: TEACHER_ID, schoolId: SCHOOL_ID });
    expect(tx.learner.updateMany).toHaveBeenCalledWith({
      where: { teacherId: TEACHER_ID },
      data: { teacherId: null },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TEACHER_ID },
      data: { advisorySectionId: null },
    });
    // Guarded on the destructive statement itself, same reasoning as the
    // learner purge: a live row must never be reachable from this page even
    // under a concurrent purge race.
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: TEACHER_ID, deletedAt: { not: null } },
    });
  });

  it("refuses when the guarded deleteMany matches no row", async () => {
    userDeleteManyCount = 0;
    const tx = makeTx();

    await expect(
      purgeTeacherRecord(tx, { teacherId: TEACHER_ID, schoolId: SCHOOL_ID })
    ).rejects.toThrow();
  });

  it("skips releaseTeacherAdvisory for an orphaned teacher with a null schoolId, and still nulls learner.teacherId + advisorySectionId + deletes", async () => {
    const tx = makeTx();

    const result = await purgeTeacherRecord(tx, { teacherId: TEACHER_ID, schoolId: null });

    expect(releaseTeacherAdvisory).not.toHaveBeenCalled();
    expect(tx.learner.updateMany).toHaveBeenCalledWith({
      where: { teacherId: TEACHER_ID },
      data: { teacherId: null },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TEACHER_ID },
      data: { advisorySectionId: null },
    });
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: TEACHER_ID, deletedAt: { not: null } },
    });
    // With no school to scope releaseTeacherAdvisory to, the released-learner
    // count must come from the unscoped `learner.updateMany` itself (4, per
    // the stub), not from the (never-called) advisory helper's stub value.
    expect(result.releasedLearnerCount).toBe(4);
    expect(result.releasedSectionIds).toEqual([]);
  });

  it("returns the released advisory info and the pre-delete counts", async () => {
    const tx = makeTx({ teacherSection: 2, notification: 1 });

    const result = await purgeTeacherRecord(tx, { teacherId: TEACHER_ID, schoolId: SCHOOL_ID });

    expect(result.releasedSectionIds).toEqual(["section-a", "section-b"]);
    expect(result.releasedLearnerCount).toBe(4);
    expect(result.counts).toMatchObject({ teacherSection: 2, notification: 1 });
  });
});
