import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactivateEnrollment } from "@/lib/learners/reactivate-enrollment";

/**
 * A12: bulk archive/delete updateMany calls are tenant-scoped inside the
 * transaction and assert the matched count. A13: reactivateEnrollment locks the
 * learner row, and a P2002 from the one-ACTIVE partial unique index propagates
 * (it is never swallowed or reported as success).
 */

const SCHOOL_ID = "school-1";
const TEACHER_ID = "teacher-1";
const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";

type Row = { id: string; schoolId: string; deletedAt: Date | null; archivedAt: Date | null };
let rows: Row[];
const enrollmentUpdateMany = vi.fn();

function matches(
  r: Row,
  w: { id: { in: string[] }; schoolId?: string; deletedAt?: null; archivedAt?: null }
) {
  if (!w.id.in.includes(r.id)) return false;
  if (w.schoolId !== undefined && r.schoolId !== w.schoolId) return false;
  if (w.deletedAt === null && r.deletedAt !== null) return false;
  if (w.archivedAt === null && r.archivedAt !== null) return false;
  return true;
}

const learnerUpdateMany = vi.fn(
  async (args: { where: Parameters<typeof matches>[1]; data: Partial<Row> }) => {
    const hit = rows.filter((r) => matches(r, args.where));
    for (const r of hit) Object.assign(r, args.data);
    return { count: hit.length };
  }
);

vi.mock("@/lib/prisma", () => {
  const tx = {
    learner: { updateMany: (a: never) => learnerUpdateMany(a) },
    enrollment: { updateMany: (a: never) => enrollmentUpdateMany(a) },
  };
  return {
    prisma: {
      learner: {
        // The out-of-transaction read deliberately ignores tenancy (as a stale
        // or racing read could), so only the in-transaction guard protects.
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          rows
            .filter((r) => args.where.id.in.includes(r.id))
            .map((r) => ({
              id: r.id,
              schoolId: SCHOOL_ID,
              teacherId: TEACHER_ID,
              aralTeacherId: null,
              gradeLevelId: "g1",
              isAralLearner: false,
            })),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async () => ({ id: TEACHER_ID, schoolId: SCHOOL_ID, role: "TEACHER" }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  writeAuditMany: vi.fn(),
  AUDIT_ACTIONS: {},
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({ revalidateLearnerScoped: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyAralAssigned: vi.fn() }));

const { archiveLearners, deleteLearners } = await import("@/lib/actions/learner");

function form(ids: string[]) {
  const fd = new FormData();
  for (const id of ids) fd.append("learnerIds", id);
  return fd;
}

beforeEach(() => {
  learnerUpdateMany.mockClear();
  enrollmentUpdateMany.mockReset();
  rows = [
    { id: MINE, schoolId: SCHOOL_ID, deletedAt: null, archivedAt: null },
    { id: THEIRS, schoolId: "school-2", deletedAt: null, archivedAt: null },
  ];
});

describe.each([
  ["archiveLearners", archiveLearners, "archivedAt"],
  ["deleteLearners", deleteLearners, "deletedAt"],
] as const)("%s — in-transaction tenancy", (_name, run, field) => {
  it("scopes the write by schoolId and does not touch another school's row", async () => {
    const res = await run(form([MINE, THEIRS]));

    expect(res.ok).toBe(false);
    expect((res as { code?: string }).code).toBe("NOT_FOUND");
    expect(learnerUpdateMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL_ID);
    expect(rows.find((r) => r.id === THEIRS)![field]).toBeNull();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
  });

  it("succeeds when every id is in the caller's school", async () => {
    const res = await run(form([MINE]));
    expect(res.ok).toBe(true);
    expect(enrollmentUpdateMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL_ID);
  });
});

describe("reactivateEnrollment — concurrent ACTIVE insert", () => {
  it("locks the learner row before the existence check", async () => {
    const order: string[] = [];
    const rawCalls: { sql: string; values: unknown[] }[] = [];
    const tx = {
      $queryRaw: vi
        .fn()
        .mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          order.push("lock");
          rawCalls.push({ sql: strings.join("?"), values });
          return [];
        }),
      enrollment: {
        findFirst: vi.fn().mockImplementation(async () => {
          order.push("find");
          return { id: "existing" };
        }),
      },
    } as unknown as import("@prisma/client").Prisma.TransactionClient;

    await reactivateEnrollment(tx, {
      id: "l1",
      schoolId: SCHOOL_ID,
      gradeLevelId: "g1",
      sectionId: null,
      teacherId: null,
    });

    expect(order).toEqual(["lock", "find"]);
    expect(rawCalls).toHaveLength(1);
    const { sql, values } = rawCalls[0];
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/"Learner"/);
    // Tenant predicate and learner id are bound parameters (placeholders), in order.
    expect(sql).toMatch(/"id" = \?/);
    expect(sql).toMatch(/"schoolId" = \?/);
    expect(values).toEqual(["l1", SCHOOL_ID]);
  });

  it("lets a P2002 from enrollment.create propagate, never reporting success", async () => {
    const dup = Object.assign(new Error("dup"), { code: "P2002" });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      enrollment: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(dup),
      },
      schoolYear: { findFirst: async () => ({ id: "y1" }) },
    } as unknown as import("@prisma/client").Prisma.TransactionClient;

    await expect(
      reactivateEnrollment(tx, {
        id: "l1",
        schoolId: SCHOOL_ID,
        gradeLevelId: "g1",
        sectionId: null,
        teacherId: null,
      })
    ).rejects.toBe(dup);
  });

  it("rethrows non-unique errors", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      enrollment: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error("boom")),
      },
      schoolYear: { findFirst: async () => ({ id: "y1" }) },
    } as unknown as import("@prisma/client").Prisma.TransactionClient;

    await expect(
      reactivateEnrollment(tx, {
        id: "l1",
        schoolId: SCHOOL_ID,
        gradeLevelId: "g1",
        sectionId: null,
        teacherId: null,
      })
    ).rejects.toThrow("boom");
  });
});
