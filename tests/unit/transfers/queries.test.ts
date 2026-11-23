import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const calls = vi.hoisted(() => ({ schoolFindMany: [] as Row[] }));
const db = vi.hoisted(() => ({ me: null as Row | null, transfers: [] as Row[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      findFirst: vi.fn(async () => db.me),
      findMany: vi.fn(async (args: Row) => {
        calls.schoolFindMany.push(args);
        return [{ id: "b", name: "Bravo ES" }];
      }),
    },
    schoolTransferRequest: { findMany: vi.fn(async () => db.transfers) },
  },
}));

import { listSchoolTransfers, listTransferTargets } from "@/lib/transfers/queries";

beforeEach(() => {
  calls.schoolFindMany = [];
  db.me = { division: "Division of X" };
  db.transfers = [];
});

describe("listTransferTargets", () => {
  it("asks only for active schools in the same division, not this one", async () => {
    await expect(listTransferTargets("a")).resolves.toEqual([{ id: "b", name: "Bravo ES" }]);
    expect(calls.schoolFindMany[0]).toMatchObject({
      where: {
        id: { not: "a" },
        isActive: true,
        deletedAt: null,
        division: { equals: "Division of X", mode: "insensitive" },
      },
    });
  });

  it("returns nothing and asks nothing when the school has no division", async () => {
    db.me = { division: "   " };
    await expect(listTransferTargets("a")).resolves.toEqual([]);
    expect(calls.schoolFindMany).toHaveLength(0);
  });
});

describe("listSchoolTransfers", () => {
  it("shows an expired waiting row as EXPIRED", async () => {
    db.transfers = [
      {
        id: "t1",
        batchId: "b1",
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1),
        createdAt: new Date(),
        reason: null,
        decisionNote: null,
        schoolId: "a",
        fromSchool: { name: "Alpha ES" },
        toSchool: { name: "Bravo ES" },
        requestedBy: { fullName: "Head A" },
        learner: { fullName: "Cruz, Ana", gradeLevel: { type: "GRADE_4" }, section: { name: "Mabini" } },
        user: null,
      },
    ];
    const rows = await listSchoolTransfers("a", "LEARNER", "history");
    expect(rows[0]).toMatchObject({ status: "EXPIRED", otherSchoolName: "Bravo ES", direction: "outgoing", personName: "Cruz, Ana" });
  });
});
