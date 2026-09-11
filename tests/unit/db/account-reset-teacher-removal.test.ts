import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Super Admin's teacher removal (per school, per selection, or every
 * teacher) must leave advisories in the same state the School Head's Remove
 * does: sections Unassigned, learners adviser-less. Both paths call
 * `releaseTeacherAdvisory`, which is mocked here — its end state is tested on
 * its own — so these assertions are about the wiring: called per teacher, with
 * that teacher's own school, in the same transaction as the soft delete.
 */

type Teacher = { id: string; authId: string; fullName: string; email: string; schoolId: string | null };

let teachers: Teacher[];
let order: string[];

const tx = {
  user: {
    update: vi.fn(async (args: { where: { id: string } }) => {
      order.push(`update:${args.where.id}`);
      return {};
    }),
  },
};

const userFindMany = vi.fn(async (args: { where: { id?: { in: string[] }; schoolId?: string } }) =>
  teachers.filter(
    (t) =>
      (!args.where.id || args.where.id.in.includes(t.id)) &&
      (!args.where.schoolId || t.schoolId === args.where.schoolId)
  )
);
const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    user: {
      findMany: (...a: unknown[]) => userFindMany(...(a as [never])),
    },
  },
}));

const deleteUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser } } }),
}));

const releaseTeacherAdvisory = vi.fn();
vi.mock("@/lib/teachers/release-advisory", () => ({
  releaseTeacherAdvisory: (...a: unknown[]) => releaseTeacherAdvisory(...a),
}));

const { removeTeacherAccountsByIds, removeAllTeacherAccounts } = await import(
  "@/lib/db/account-reset"
);

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  teachers = [
    { id: "t-a", authId: "auth-a", fullName: "Ana", email: "ana@x.ph", schoolId: "school-1" },
    { id: "t-b", authId: "auth-b", fullName: "Ben", email: "ben@x.ph", schoolId: "school-2" },
  ];
  deleteUser.mockResolvedValue({ error: null });
  releaseTeacherAdvisory.mockImplementation(async (_tx: unknown, p: { teacherId: string }) => {
    order.push(`release:${p.teacherId}`);
    return { sectionIds: [], learnerCount: 0 };
  });
});

describe("Super Admin teacher removal", () => {
  it("releases the advisory, scoped to the teacher's own school, before the soft delete", async () => {
    const result = await removeTeacherAccountsByIds("school-1", ["t-a"]);

    expect(result).toEqual({ processed: 1, failed: [] });
    expect(releaseTeacherAdvisory).toHaveBeenCalledWith(tx, {
      teacherId: "t-a",
      schoolId: "school-1",
    });
    expect(order).toEqual(["release:t-a", "update:t-a"]);
  });

  it("uses each teacher's own school when removing across every school", async () => {
    await removeAllTeacherAccounts();

    expect(releaseTeacherAdvisory).toHaveBeenCalledWith(tx, { teacherId: "t-a", schoolId: "school-1" });
    expect(releaseTeacherAdvisory).toHaveBeenCalledWith(tx, { teacherId: "t-b", schoolId: "school-2" });
  });

  it("skips the release for a teacher attached to no school — there is no tenant to release into", async () => {
    teachers = [{ ...teachers[0], schoolId: null }];

    const result = await removeAllTeacherAccounts();

    expect(result.processed).toBe(1);
    expect(releaseTeacherAdvisory).not.toHaveBeenCalled();
    expect(order).toEqual(["update:t-a"]);
  });

  it("records a failed release against that teacher and carries on with the rest", async () => {
    releaseTeacherAdvisory.mockImplementation(async (_tx: unknown, p: { teacherId: string }) => {
      if (p.teacherId === "t-a") throw new Error("deadlock");
      return { sectionIds: [], learnerCount: 0 };
    });

    const result = await removeAllTeacherAccounts();

    expect(result.processed).toBe(1);
    expect(result.failed).toEqual([{ id: "t-a", label: "Ana", reason: "deadlock" }]);
  });
});
