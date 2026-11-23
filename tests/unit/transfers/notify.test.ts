import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ users: [] as Row[], transfers: [] as Row[], notifications: [] as Row[] }));
const fail = vi.hoisted(() => ({ on: false }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.users.filter((u) => u.schoolId === where.schoolId && u.role === where.role)
      ),
    },
    schoolTransferRequest: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => db.transfers.find((t) => t.batchId === where.batchId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; batchId?: { in: string[] } } }) =>
        db.transfers.filter((t) =>
          where.id ? where.id.in.includes(t.id as string) : where.batchId!.in.includes(t.batchId as string)
        )
      ),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        if (fail.on) throw new Error("db down");
        db.notifications.push(...data.map((d, i) => ({ id: `n-${db.notifications.length + i}`, readAt: null, ...d })));
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        db.notifications.filter((n) => n.recipientId === where.recipientId && n.schoolId === where.schoolId)
      ),
    },
  },
}));

import { getSchoolTransferBellNotifications, notifySchoolTransfer } from "@/lib/transfers/notify";

beforeEach(() => {
  fail.on = false;
  db.users = [
    { id: "sh-a", schoolId: "a", role: "SCHOOL_HEAD" },
    { id: "sh-b", schoolId: "b", role: "SCHOOL_HEAD" },
  ];
  db.transfers = [
    {
      id: "t1",
      batchId: "batch",
      kind: "TEACHER",
      schoolId: "a",
      toSchoolId: "b",
      status: "PENDING",
      userId: "teacher-1",
      fromSchool: { name: "Alpha ES" },
      toSchool: { name: "Bravo ES" },
    },
  ];
  db.notifications = [];
});

describe("notifySchoolTransfer", () => {
  it("tells the receiving School Head about a new batch", async () => {
    await notifySchoolTransfer({ type: "REQUESTED", batchId: "batch", actorId: "sh-a" });
    expect(db.notifications).toEqual([
      expect.objectContaining({ recipientId: "sh-b", schoolId: "b", type: "SCHOOL_TRANSFER_REQUESTED", batchId: "batch" }),
    ]);
  });

  it("tells the sender and the moved teacher when a teacher is accepted", async () => {
    db.transfers[0].status = "ACCEPTED";
    await notifySchoolTransfer({ type: "DECIDED", ids: ["t1"], actorId: "sh-b" });
    expect(db.notifications.map((n) => n.recipientId).sort()).toEqual(["sh-a", "teacher-1"]);
    const teacherNotice = db.notifications.find((n) => n.recipientId === "teacher-1")!;
    expect(teacherNotice.schoolId).toBe("b");

    const bell = await getSchoolTransferBellNotifications({ id: "teacher-1", schoolId: "b", role: "TEACHER" });
    expect(bell[0].title).toBe("You moved to Bravo ES.");
    expect(bell[0].description).toContain("choose Bravo ES");
  });

  it("composes the School Head's request sentence", async () => {
    await notifySchoolTransfer({ type: "REQUESTED", batchId: "batch", actorId: "sh-a" });
    const bell = await getSchoolTransferBellNotifications({ id: "sh-b", schoolId: "b", role: "SCHOOL_HEAD" });
    expect(bell[0].title).toBe("Alpha ES sent 1 teacher to your school.");
  });

  it("never throws when the write fails", async () => {
    fail.on = true;
    await expect(notifySchoolTransfer({ type: "REQUESTED", batchId: "batch", actorId: "sh-a" })).resolves.toBeUndefined();
  });
});
