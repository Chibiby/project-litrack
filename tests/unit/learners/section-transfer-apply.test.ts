import { describe, expect, it, vi } from "vitest";
import { applySectionTransferBatch } from "@/lib/learners/section-transfer-apply";
import { isAppError } from "@/lib/errors/app-error";

/**
 * `applySectionTransferBatch` is the one place Learner pointers and the ACTIVE
 * Enrollment row are moved together. It must:
 *  - compare-and-set the learners (count mismatch throws, so the caller's
 *    transaction rolls back),
 *  - close the old ACTIVE enrollment BEFORE creating the new one (the partial
 *    unique index `Enrollment_learner_active_unique` allows only one), and
 *  - change pointers only when no school year is known,
 * all in a fixed number of calls regardless of batch size.
 */

const SCHOOL = "school-1";
const GRADE = "grade-3";
const TO = "section-to";
const TEACHER = "teacher-in";
const NOW = new Date("2026-10-08T01:00:00Z");

type Calls = string[];

function makeTx(opts: {
  updatedCount: number;
  active?: { learnerId: string; schoolYearId: string }[];
  activeYear?: { id: string } | null;
}) {
  const calls: Calls = [];
  const tx = {
    learner: {
      updateMany: vi.fn(async (_args: unknown) => {
        calls.push("learner.updateMany");
        return { count: opts.updatedCount };
      }),
    },
    enrollment: {
      findMany: vi.fn(async (_args: unknown) => {
        calls.push("enrollment.findMany");
        return opts.active ?? [];
      }),
      updateMany: vi.fn(async (_args: unknown) => {
        calls.push("enrollment.updateMany");
        return { count: (opts.active ?? []).length };
      }),
      createMany: vi.fn(async (args: { data: unknown[] }) => {
        calls.push("enrollment.createMany");
        return { count: args.data.length };
      }),
    },
    schoolYear: {
      findFirst: vi.fn(async (_args: unknown) => {
        calls.push("schoolYear.findFirst");
        return opts.activeYear ?? null;
      }),
    },
  };
  return { tx, calls };
}

const moves = [
  { learnerId: "l-1", fromSectionId: "section-a" },
  { learnerId: "l-2", fromSectionId: "section-b" },
];

function run(tx: unknown) {
  return applySectionTransferBatch(tx as never, {
    schoolId: SCHOOL,
    gradeLevelId: GRADE,
    toSectionId: TO,
    teacherId: TEACHER,
    moves,
    now: NOW,
  });
}

describe("applySectionTransferBatch", () => {
  it("compare-and-sets every learner on school, grade, live state and expected section", async () => {
    const { tx } = makeTx({ updatedCount: 2, activeYear: null });
    await run(tx);

    expect(tx.learner.updateMany).toHaveBeenCalledWith({
      where: {
        schoolId: SCHOOL,
        gradeLevelId: GRADE,
        deletedAt: null,
        archivedAt: null,
        OR: [
          { id: "l-1", sectionId: "section-a" },
          { id: "l-2", sectionId: "section-b" },
        ],
      },
      data: { sectionId: TO, teacherId: TEACHER },
    });
  });

  it("throws TRANSFER_REQUESTS_CHANGED when a learner moved since it was read, and writes no enrollment", async () => {
    const { tx } = makeTx({ updatedCount: 1 });
    const err = await run(tx).catch((e: unknown) => e);

    expect(isAppError(err)).toBe(true);
    expect((err as { code: string }).code).toBe("TRANSFER_REQUESTS_CHANGED");
    expect(tx.enrollment.updateMany).not.toHaveBeenCalled();
    expect(tx.enrollment.createMany).not.toHaveBeenCalled();
  });

  it("closes the ACTIVE enrollment before creating the new one, keeping its school year", async () => {
    const { tx, calls } = makeTx({
      updatedCount: 2,
      active: [
        { learnerId: "l-1", schoolYearId: "sy-old" },
        { learnerId: "l-2", schoolYearId: "sy-now" },
      ],
      activeYear: { id: "sy-now" },
    });
    await run(tx);

    expect(calls.indexOf("enrollment.updateMany")).toBeGreaterThan(-1);
    expect(calls.indexOf("enrollment.updateMany")).toBeLessThan(calls.indexOf("enrollment.createMany"));
    expect(tx.enrollment.updateMany).toHaveBeenCalledWith({
      where: { learnerId: { in: ["l-1", "l-2"] }, status: "ACTIVE" },
      data: { status: "TRANSFERRED", endedAt: NOW },
    });
    expect(tx.enrollment.createMany).toHaveBeenCalledWith({
      data: [
        {
          learnerId: "l-1",
          schoolId: SCHOOL,
          schoolYearId: "sy-old",
          gradeLevelId: GRADE,
          sectionId: TO,
          teacherId: TEACHER,
          status: "ACTIVE",
        },
        {
          learnerId: "l-2",
          schoolId: SCHOOL,
          schoolYearId: "sy-now",
          gradeLevelId: GRADE,
          sectionId: TO,
          teacherId: TEACHER,
          status: "ACTIVE",
        },
      ],
    });
  });

  it("uses the school's active year for a learner with no ACTIVE enrollment", async () => {
    const { tx } = makeTx({
      updatedCount: 2,
      active: [{ learnerId: "l-1", schoolYearId: "sy-old" }],
      activeYear: { id: "sy-now" },
    });
    await run(tx);

    expect(tx.schoolYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: SCHOOL, isActive: true } })
    );
    const data = (tx.enrollment.createMany.mock.calls[0][0] as { data: { learnerId: string; schoolYearId: string }[] }).data;
    expect(data.map((d) => [d.learnerId, d.schoolYearId])).toEqual([
      ["l-1", "sy-old"],
      ["l-2", "sy-now"],
    ]);
  });

  it("with no school year at all, only the pointers change", async () => {
    const { tx } = makeTx({ updatedCount: 2, active: [], activeYear: null });
    const result = await run(tx);

    expect(result).toEqual({ moved: 2 });
    expect(tx.learner.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.enrollment.createMany).not.toHaveBeenCalled();
  });

  it("makes a fixed number of calls however large the batch is", async () => {
    const big = Array.from({ length: 100 }, (_, i) => ({ learnerId: `l-${i}`, fromSectionId: "section-a" }));
    const { tx, calls } = makeTx({
      updatedCount: 100,
      active: big.map((m) => ({ learnerId: m.learnerId, schoolYearId: "sy" })),
      activeYear: { id: "sy" },
    });
    await applySectionTransferBatch(tx as never, {
      schoolId: SCHOOL,
      gradeLevelId: GRADE,
      toSectionId: TO,
      teacherId: TEACHER,
      moves: big,
      now: NOW,
    });
    expect(calls.length).toBeLessThanOrEqual(5);
  });
});
